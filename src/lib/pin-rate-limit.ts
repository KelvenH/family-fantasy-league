import { withTransaction } from "@/lib/db";

/** Single server-side bucket — not cookie or IP keyed, so clients cannot reset it. */
const LOCKOUT_ID = "global";
const MAX_ATTEMPTS = 8;
const LOCK_MINUTES = 10;
const WINDOW_MS = 15 * 60 * 1000;
/** Slow wrong guesses so scripted brute force cannot run at full speed. */
export const FAIL_DELAY_MS = 400;

type LockoutRow = {
  failures: number;
  window_start: string | Date;
  locked_until: string | Date | null;
};

export type PinGuessResult =
  | { status: "unlocked" }
  | { status: "rejected"; attemptCount: number }
  | { status: "locked"; retryAfterSec: number; attemptCount: number };

function asTime(value: string | Date | null | undefined): number {
  if (!value) return 0;
  return new Date(value).getTime();
}

/**
 * Apply a PIN guess against the one global lockout row.
 * Lock check, failure count, and success reset run in one transaction with
 * SELECT … FOR UPDATE — concurrent requests serialize; no client-controlled key.
 */
export async function applyPinGuess(pinOk: boolean): Promise<PinGuessResult> {
  return withTransaction(async (query) => {
    await query(
      `insert into pin_lockout (id, failures, window_start, locked_until)
       values ($1, 0, now(), null)
       on conflict (id) do nothing`,
      [LOCKOUT_ID],
    );

    const rows = await query<LockoutRow>(
      `select failures, window_start, locked_until
       from pin_lockout
       where id = $1
       for update`,
      [LOCKOUT_ID],
    );
    const row = rows[0];
    if (!row) {
      return { status: "rejected", attemptCount: 0 };
    }

    const now = Date.now();
    const lockedUntil = asTime(row.locked_until);

    // Wrong guesses while locked stay locked. A correct PIN clears the lockout
    // so the family is not stuck after an attack wave.
    if (lockedUntil > now && !pinOk) {
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
        [LOCKOUT_ID],
      );
      return { status: "unlocked" };
    }

    let failures = row.failures;
    let windowStart = asTime(row.window_start);
    if (now - windowStart > WINDOW_MS) {
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
        LOCKOUT_ID,
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
    windowMs: WINDOW_MS,
  };
}
