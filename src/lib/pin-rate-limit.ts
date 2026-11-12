import { createHash, randomBytes } from "node:crypto";
import { sql, withTransaction } from "@/lib/db";
import { readCookie, requestIsSecure } from "@/lib/edit-auth";

export const RATE_COOKIE = "ff_rl";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const MAX_LOCKOUT_ROWS = 200;

type LockoutRow = {
  failures: number;
  window_start: string | Date;
  locked_until: string | Date | null;
};

export type PinGuessResult =
  | { status: "unlocked" }
  | { status: "rejected"; attemptCount: number }
  | { status: "locked"; retryAfterSec: number; attemptCount: number };

function hashId(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function asTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

function rateCookieHeader(token: string, secure: boolean): string {
  const parts = [
    `${RATE_COOKIE}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${30 * 24 * 60 * 60}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** Server-issued browser id — not taken from X-Forwarded-For. */
export function resolveRateClient(request: Request): {
  clientId: string;
  rateCookieToSet: string | null;
} {
  const existing = readCookie(request, RATE_COOKIE);
  if (existing && /^[A-Za-z0-9_-]{20,128}$/.test(existing)) {
    return { clientId: `c:${hashId(existing)}`, rateCookieToSet: null };
  }
  const token = randomBytes(32).toString("base64url");
  return {
    clientId: `c:${hashId(token)}`,
    rateCookieToSet: rateCookieHeader(token, requestIsSecure(request)),
  };
}

async function pruneLockoutRows(): Promise<void> {
  await sql(
    `delete from pin_lockout
     where (locked_until is null or locked_until < now())
       and window_start < now() - interval '1 day'`,
  );
  const countRows = await sql<{ count: string }>(
    `select count(*)::text as count from pin_lockout`,
  );
  const count = Number(countRows[0]?.count ?? 0);
  if (count <= MAX_LOCKOUT_ROWS) return;
  await sql(
    `delete from pin_lockout
     where id in (
       select id from pin_lockout
       order by window_start asc
       limit $1
     )`,
    [count - MAX_LOCKOUT_ROWS],
  );
}

/**
 * Apply a PIN guess in one transaction under a row lock.
 * Lock check, failure increment, and success reset are not separate steps —
 * concurrent requests serialize on the same browser bucket.
 */
export async function applyPinGuess(
  clientId: string,
  pinOk: boolean,
): Promise<PinGuessResult> {
  await pruneLockoutRows();

  return withTransaction(async (query) => {
    await query(
      `insert into pin_lockout (id, failures, window_start, locked_until)
       values ($1, 0, now(), null)
       on conflict (id) do nothing`,
      [clientId],
    );

    const rows = await query<LockoutRow>(
      `select failures, window_start, locked_until
       from pin_lockout
       where id = $1
       for update`,
      [clientId],
    );
    const row = rows[0];
    if (!row) {
      return { status: "rejected", attemptCount: 0 };
    }

    const now = Date.now();
    const lockedUntil = asTime(row.locked_until);
    if (lockedUntil > now) {
      return {
        status: "locked",
        retryAfterSec: Math.ceil((lockedUntil - now) / 1000),
        attemptCount: row.failures,
      };
    }

    if (pinOk) {
      await query(
        `update pin_lockout
         set failures = 0, window_start = now(), locked_until = null
         where id = $1`,
        [clientId],
      );
      return { status: "unlocked" };
    }

    let failures = row.failures;
    let windowStart = asTime(row.window_start);
    if (now - windowStart > 15 * 60 * 1000) {
      failures = 0;
      windowStart = now;
    }
    failures += 1;

    const shouldLock = failures >= MAX_ATTEMPTS;
    const nextLock = shouldLock
      ? new Date(now + LOCK_MINUTES * 60 * 1000).toISOString()
      : null;

    await query(
      `update pin_lockout
       set failures = $2,
           window_start = $3,
           locked_until = $4
       where id = $1`,
      [
        clientId,
        shouldLock ? 0 : failures,
        new Date(windowStart).toISOString(),
        nextLock,
      ],
    );

    if (shouldLock) {
      return {
        status: "locked",
        retryAfterSec: LOCK_MINUTES * 60,
        attemptCount: failures,
      };
    }
    return { status: "rejected", attemptCount: failures };
  });
}

export function pinAttemptLimits() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    lockMinutes: LOCK_MINUTES,
  };
}
