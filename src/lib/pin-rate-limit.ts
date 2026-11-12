import { sql } from "@/lib/db";

const LOCKOUT_ID = "global";
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

/**
 * Global PIN attempt lockout (not keyed on client IP / X-Forwarded-For).
 * One fixed DB row — no per-visitor map that attackers can grow.
 */
async function ensureLockoutRow(): Promise<void> {
  await sql(
    `insert into pin_lockout (id, failures, window_start, locked_until)
     values ($1, 0, now(), null)
     on conflict (id) do nothing`,
    [LOCKOUT_ID],
  );
}

type LockoutRow = {
  failures: number;
  window_start: string | Date;
  locked_until: string | Date | null;
};

function asTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

export async function getPinLockout(): Promise<
  { locked: true; retryAfterSec: number } | { locked: false }
> {
  await ensureLockoutRow();
  const rows = await sql<LockoutRow>(
    `select failures, window_start, locked_until from pin_lockout where id = $1`,
    [LOCKOUT_ID],
  );
  const row = rows[0];
  if (!row) return { locked: false };
  const remaining = asTime(row.locked_until) - Date.now();
  if (remaining > 0) {
    return { locked: true, retryAfterSec: Math.ceil(remaining / 1000) };
  }
  return { locked: false };
}

export async function recordPinFailure(): Promise<{
  locked: boolean;
  retryAfterSec: number;
  attemptCount: number;
}> {
  await ensureLockoutRow();
  const rows = await sql<LockoutRow>(
    `select failures, window_start, locked_until from pin_lockout where id = $1`,
    [LOCKOUT_ID],
  );
  const row = rows[0];
  if (!row) {
    return { locked: false, retryAfterSec: 0, attemptCount: 0 };
  }

  const t = Date.now();
  const lockedUntil = asTime(row.locked_until);
  if (lockedUntil > t) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((lockedUntil - t) / 1000),
      attemptCount: row.failures,
    };
  }

  let failures = row.failures;
  let windowStart = asTime(row.window_start);
  if (t - windowStart > WINDOW_MS) {
    failures = 0;
    windowStart = t;
  }

  failures += 1;
  const attemptCount = failures;

  if (failures >= MAX_ATTEMPTS) {
    const nextLock = new Date(t + LOCKOUT_MS).toISOString();
    await sql(
      `update pin_lockout
       set failures = 0, window_start = $2, locked_until = $3
       where id = $1`,
      [LOCKOUT_ID, new Date(t).toISOString(), nextLock],
    );
    return {
      locked: true,
      retryAfterSec: Math.ceil(LOCKOUT_MS / 1000),
      attemptCount,
    };
  }

  await sql(
    `update pin_lockout
     set failures = $2, window_start = $3, locked_until = null
     where id = $1`,
    [LOCKOUT_ID, failures, new Date(windowStart).toISOString()],
  );

  return { locked: false, retryAfterSec: 0, attemptCount };
}

export async function recordPinSuccess(): Promise<void> {
  await ensureLockoutRow();
  await sql(
    `update pin_lockout
     set failures = 0, window_start = now(), locked_until = null
     where id = $1`,
    [LOCKOUT_ID],
  );
}

export function pinAttemptLimits() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
    lockoutMs: LOCKOUT_MS,
  };
}
