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
  // Progressive backoff; no multi-minute hard lockout that blocks the family.
  const capped = Math.min(Math.max(failures, 1), 10);
  return Math.min(30_000, 250 * 2 ** (capped - 1));
}

/**
 * Record a PIN guess in a single transactional UPDATE under an advisory lock.
 * There is no separate pre-check step: success resets and failure increments
 * in the same statement, so concurrent requests cannot bypass the counter.
 */
export async function applyPinGuess(pinOk: boolean): Promise<PinGuessResult> {
  return withTransaction(async (query) => {
    // Serialize all PIN attempts app-wide for the duration of this transaction.
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
