import { withTransaction } from "@/lib/db";

/**
 * One server-owned attempt bucket for the whole app.
 * Not keyed on cookies, IPs, or X-Forwarded-For — clients cannot reset it.
 */
const ATTEMPT_ID = "global";
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 5;

export type PinGuessResult =
  | { status: "unlocked" }
  | { status: "rejected"; attemptCount: number }
  | { status: "locked"; retryAfterSec: number; attemptCount: number };

function asTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

/**
 * Apply a PIN guess with one advisory lock + one UPDATE.
 * Success, failure count, and hard lockout are decided in that single statement
 * so concurrent requests cannot bypass the attempt cap. When locked, wrong
 * guesses are refused (429) rather than only delayed.
 */
export async function applyPinGuess(pinOk: boolean): Promise<PinGuessResult> {
  return withTransaction(async (query) => {
    await query(`select pg_advisory_xact_lock(87231401)`);

    await query(
      `insert into pin_lockout (id, failures, window_start, locked_until)
       values ($1, 0, now(), null)
       on conflict (id) do nothing`,
      [ATTEMPT_ID],
    );

    const rows = await query<{
      failures: number;
      locked_until: string | Date | null;
    }>(
      `update pin_lockout set
         failures = case
           when locked_until is not null and locked_until > now() and not $2::boolean
             then failures
           when $2::boolean then 0
           when window_start < now() - interval '15 minutes' then 1
           else failures + 1
         end,
         window_start = case
           when locked_until is not null and locked_until > now() and not $2::boolean
             then window_start
           when $2::boolean then now()
           when window_start < now() - interval '15 minutes' then now()
           else window_start
         end,
         locked_until = case
           when locked_until is not null and locked_until > now() and not $2::boolean
             then locked_until
           when $2::boolean then null
           when (
             case
               when window_start < now() - interval '15 minutes' then 1
               else failures + 1
             end
           ) >= $3
             then now() + ($4 * interval '1 minute')
           else null
         end
       where id = $1
       returning failures, locked_until`,
      [ATTEMPT_ID, pinOk, MAX_ATTEMPTS, LOCK_MINUTES],
    );

    const row = rows[0];
    if (!row) {
      return { status: "rejected", attemptCount: 0 };
    }

    if (pinOk) {
      return { status: "unlocked" };
    }

    const remaining = asTime(row.locked_until) - Date.now();
    if (remaining > 0) {
      return {
        status: "locked",
        retryAfterSec: Math.ceil(remaining / 1000),
        attemptCount: row.failures,
      };
    }

    return { status: "rejected", attemptCount: row.failures };
  });
}

export function pinAttemptLimits() {
  return { maxAttempts: MAX_ATTEMPTS, lockMinutes: LOCK_MINUTES };
}
