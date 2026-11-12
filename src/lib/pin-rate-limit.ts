import { createHash, randomBytes } from "node:crypto";
import { sql } from "@/lib/db";
import { readCookie, requestIsSecure } from "@/lib/edit-auth";

export const RATE_COOKIE = "ff_rl";
const MAX_ATTEMPTS = 5;
const GLOBAL_ID = "g:all";
const GLOBAL_MAX_ATTEMPTS = 60;
const MAX_LOCKOUT_ROWS = 200;

type LockoutRow = {
  failures: number;
  locked_until: string | Date | null;
};

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
     where id <> $1
       and (locked_until is null or locked_until < now())
       and window_start < now() - interval '1 day'`,
    [GLOBAL_ID],
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
       where id <> $1
       order by window_start asc
       limit $2
     )`,
    [GLOBAL_ID, count - MAX_LOCKOUT_ROWS],
  );
}

/**
 * Atomically record a failed PIN guess.
 * Increment + lock happen in one UPDATE so parallel guesses cannot bypass the limit.
 */
async function atomicRecordFailure(
  id: string,
  maxAttempts: number,
  lockMinutes: number,
): Promise<{ locked: boolean; retryAfterSec: number; attemptCount: number }> {
  await sql(
    `insert into pin_lockout (id, failures, window_start, locked_until)
     values ($1, 0, now(), null)
     on conflict (id) do nothing`,
    [id],
  );

  // failures / window_start / locked_until on the right-hand side are OLD row values,
  // so concurrent UPDATEs serialize on the row and each guess increments once.
  const rows = await sql<LockoutRow>(
    `update pin_lockout set
       failures = case
         when locked_until is not null and locked_until > now() then failures
         when window_start < now() - interval '15 minutes' then 1
         else failures + 1
       end,
       window_start = case
         when locked_until is not null and locked_until > now() then window_start
         when window_start < now() - interval '15 minutes' then now()
         else window_start
       end,
       locked_until = case
         when locked_until is not null and locked_until > now() then locked_until
         when (
           case
             when window_start < now() - interval '15 minutes' then 1
             else failures + 1
           end
         ) >= $2
           then now() + ($3 * interval '1 minute')
         else null
       end
     where id = $1
     returning failures, locked_until`,
    [id, maxAttempts, lockMinutes],
  );

  const row = rows[0];
  if (!row) {
    return { locked: false, retryAfterSec: 0, attemptCount: 0 };
  }
  const remaining = asTime(row.locked_until) - Date.now();
  if (remaining > 0) {
    return {
      locked: true,
      retryAfterSec: Math.ceil(remaining / 1000),
      attemptCount: row.failures,
    };
  }
  return {
    locked: false,
    retryAfterSec: 0,
    attemptCount: row.failures,
  };
}

/** Read-only lock check (soft). Enforcement is atomicRecordFailure. */
export async function getPinLockout(clientId: string): Promise<
  { locked: true; retryAfterSec: number } | { locked: false }
> {
  const rows = await sql<LockoutRow>(
    `select failures, locked_until from pin_lockout
     where (id = $1 or id = $2)
       and locked_until is not null
       and locked_until > now()
     order by locked_until desc
     limit 1`,
    [clientId, GLOBAL_ID],
  );
  const row = rows[0];
  if (!row) return { locked: false };
  const remaining = asTime(row.locked_until) - Date.now();
  if (remaining > 0) {
    return { locked: true, retryAfterSec: Math.ceil(remaining / 1000) };
  }
  return { locked: false };
}

export async function recordPinFailure(clientId: string): Promise<{
  locked: boolean;
  retryAfterSec: number;
  attemptCount: number;
}> {
  await pruneLockoutRows();
  const client = await atomicRecordFailure(clientId, MAX_ATTEMPTS, 15);
  const global = await atomicRecordFailure(GLOBAL_ID, GLOBAL_MAX_ATTEMPTS, 2);
  if (client.locked) return client;
  if (global.locked) {
    return {
      locked: true,
      retryAfterSec: global.retryAfterSec,
      attemptCount: client.attemptCount,
    };
  }
  return client;
}

export async function recordPinSuccess(clientId: string): Promise<void> {
  await sql(
    `update pin_lockout
     set failures = 0, window_start = now(), locked_until = null
     where id = $1`,
    [clientId],
  );
}

export function pinAttemptLimits() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    globalMaxAttempts: GLOBAL_MAX_ATTEMPTS,
  };
}
