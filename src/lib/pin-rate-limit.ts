import { withTransaction } from "@/lib/db";

/**
 * One server-owned attempt bucket for the whole app.
 * Not keyed on cookies, IPs, or X-Forwarded-For — clients cannot reset it.
 */
const ATTEMPT_ID = "global";
const MAX_ATTEMPTS = 5;
const BASE_LOCK_MINUTES = 5;
const MAX_LOCK_MINUTES = 60;
const QUIET_RESET_HOURS = 24;

export type PinGuessResult =
  | { status: "unlocked" }
  | { status: "rejected"; attemptCount: number }
  | { status: "locked"; retryAfterSec: number; attemptCount: number };

function asTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

/** 5, 10, 20, 40, then 60 minutes for every further lockout. */
function lockMinutesFor(lockouts: number): number {
  return Math.min(MAX_LOCK_MINUTES, BASE_LOCK_MINUTES * 2 ** lockouts);
}

/**
 * Apply a PIN guess under a transaction-scoped advisory lock so concurrent
 * requests are serialised and cannot exceed the cap.
 *
 * - While locked, every guess is refused (429) — including the correct PIN —
 *   so guessing cannot continue during a lockout.
 * - Failures and lockout escalation reset after a correct PIN or 24 quiet
 *   hours, so pacing guesses under the cap yields at most a few per day.
 * - Each lockout doubles the wait (capped at an hour), limiting a 6-digit PIN
 *   to roughly 120 guesses a day.
 * - A lockout only affects new unlocks: devices that already entered the PIN
 *   keep their 90-day edit session, so strangers cannot lock the family out.
 */
export async function applyPinGuess(pinOk: boolean): Promise<PinGuessResult> {
  return withTransaction(async (query) => {
    await query(`select pg_advisory_xact_lock(87231401)`);

    await query(
      `insert into pin_lockout (id, failures, window_start, locked_until, lockouts)
       values ($1, 0, now(), null, 0)
       on conflict (id) do nothing`,
      [ATTEMPT_ID],
    );

    const rows = await query<{
      failures: number;
      lockouts: number;
      locked_until: string | Date | null;
      window_start: string | Date | null;
    }>(
      `select failures, lockouts, locked_until, window_start
       from pin_lockout where id = $1`,
      [ATTEMPT_ID],
    );
    const row = rows[0] ?? {
      failures: 0,
      lockouts: 0,
      locked_until: null,
      window_start: null,
    };

    const remaining = asTime(row.locked_until) - Date.now();
    if (
      remaining <= 0 &&
      Date.now() - asTime(row.window_start) > QUIET_RESET_HOURS * 3600_000
    ) {
      row.failures = 0;
      row.lockouts = 0;
    }
    if (remaining > 0) {
      return {
        status: "locked",
        retryAfterSec: Math.ceil(remaining / 1000),
        attemptCount: row.failures,
      };
    }

    if (pinOk) {
      await query(
        `update pin_lockout
         set failures = 0, lockouts = 0, locked_until = null, window_start = now()
         where id = $1`,
        [ATTEMPT_ID],
      );
      return { status: "unlocked" };
    }

    const failures = row.failures + 1;
    if (failures >= MAX_ATTEMPTS) {
      const minutes = lockMinutesFor(row.lockouts);
      await query(
        `update pin_lockout
         set failures = 0,
             lockouts = $3,
             locked_until = now() + ($2 * interval '1 minute'),
             window_start = now()
         where id = $1`,
        [ATTEMPT_ID, minutes, row.lockouts + 1],
      );
      return {
        status: "locked",
        retryAfterSec: minutes * 60,
        attemptCount: failures,
      };
    }

    await query(
      `update pin_lockout
       set failures = $2, lockouts = $3, window_start = now()
       where id = $1`,
      [ATTEMPT_ID, failures, row.lockouts],
    );
    return { status: "rejected", attemptCount: failures };
  });
}

export function pinAttemptLimits() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    lockMinutes: BASE_LOCK_MINUTES,
    maxLockMinutes: MAX_LOCK_MINUTES,
  };
}
