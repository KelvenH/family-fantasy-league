import { withTransaction } from "@/lib/db";

/**
 * One server-owned attempt counter for the whole app.
 * Not keyed on cookies, IPs, or X-Forwarded-For — clients cannot reset it.
 */
const ATTEMPT_ID = "global";

export type PinGuessResult =
  | { status: "unlocked" }
  | { status: "rejected"; attemptCount: number; delayMs: number };

function delayForFailures(failures: number): number {
  // Progressive backoff up to 60s; no hard lockout that blocks a correct password.
  const capped = Math.min(Math.max(failures, 1), 12);
  return Math.min(60_000, 500 * 2 ** (capped - 1));
}

/**
 * Record a password guess in a single transactional UPDATE under an advisory lock.
 * Success resets and failure increments in the same statement — no separate
 * check/record race, and concurrent requests cannot bypass the counter.
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

    const rows = await query<{ failures: number }>(
      `update pin_lockout set
         failures = case
           when $2::boolean then 0
           when window_start < now() - interval '15 minutes' then 1
           else failures + 1
         end,
         window_start = case
           when $2::boolean then now()
           when window_start < now() - interval '15 minutes' then now()
           else window_start
         end,
         locked_until = null
       where id = $1
       returning failures`,
      [ATTEMPT_ID, pinOk],
    );

    const failures = Number(rows[0]?.failures ?? 0);
    if (pinOk) {
      return { status: "unlocked" };
    }
    return {
      status: "rejected",
      attemptCount: failures,
      delayMs: delayForFailures(failures),
    };
  });
}
