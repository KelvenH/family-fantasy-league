type Bucket = {
  failures: number;
  windowStart: number;
  lockedUntil: number;
};

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCKOUT_MS = 15 * 60 * 1000;

const buckets = new Map<string, Bucket>();

function now(): number {
  return Date.now();
}

function getBucket(key: string): Bucket {
  const existing = buckets.get(key);
  if (existing) return existing;
  const created: Bucket = {
    failures: 0,
    windowStart: now(),
    lockedUntil: 0,
  };
  buckets.set(key, created);
  return created;
}

export function clientAttemptKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return `ip:${first}`;
  }
  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return `ip:${realIp}`;
  return "ip:unknown";
}

export function getPinLockout(
  key: string,
): { locked: true; retryAfterSec: number } | { locked: false } {
  const bucket = getBucket(key);
  const remaining = bucket.lockedUntil - now();
  if (remaining > 0) {
    return { locked: true, retryAfterSec: Math.ceil(remaining / 1000) };
  }
  return { locked: false };
}

export function recordPinFailure(key: string): {
  locked: boolean;
  retryAfterSec: number;
  attemptCount: number;
} {
  const bucket = getBucket(key);
  const t = now();

  if (bucket.lockedUntil > t) {
    return {
      locked: true,
      retryAfterSec: Math.ceil((bucket.lockedUntil - t) / 1000),
      attemptCount: bucket.failures,
    };
  }

  if (t - bucket.windowStart > WINDOW_MS) {
    bucket.windowStart = t;
    bucket.failures = 0;
  }

  bucket.failures += 1;
  const attemptCount = bucket.failures;

  if (bucket.failures >= MAX_ATTEMPTS) {
    bucket.lockedUntil = t + LOCKOUT_MS;
    bucket.failures = 0;
    bucket.windowStart = t;
    return {
      locked: true,
      retryAfterSec: Math.ceil(LOCKOUT_MS / 1000),
      attemptCount,
    };
  }

  return { locked: false, retryAfterSec: 0, attemptCount };
}

export function recordPinSuccess(key: string): void {
  buckets.delete(key);
}

export function pinAttemptLimits() {
  return {
    maxAttempts: MAX_ATTEMPTS,
    windowMs: WINDOW_MS,
    lockoutMs: LOCKOUT_MS,
  };
}
