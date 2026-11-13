import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const EDIT_COOKIE = "ff_edit";
/** Simple family PIN: 6–8 digits. Brute force is blocked by hard server-side rate limits. */
export const PIN_PATTERN = /^\d{6,8}$/;
const MAX_SESSIONS = 100;
/**
 * Family devices stay unlocked for 90 days, so a stranger tripping the global
 * PIN lockout cannot block people who have already unlocked. "Lock" revokes.
 */
const SESSION_DAYS = 90;

export function getExpectedPin(): string | null {
  const fromEnv = process.env.EDIT_PIN?.trim();
  if (fromEnv && PIN_PATTERN.test(fromEnv)) return fromEnv;
  return null;
}

export function pinConfigured(): boolean {
  return getExpectedPin() !== null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function requestIsSecure(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const proto = request.headers.get("x-forwarded-proto");
  return proto?.split(",")[0]?.trim() === "https";
}

function cookieExtras(secure: boolean, maxAgeSec: number): string {
  const parts = [
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildAuthCookie(token: string, secure: boolean): string {
  return `${EDIT_COOKIE}=${token}; ${cookieExtras(secure, SESSION_DAYS * 24 * 60 * 60)}`;
}

export function clearAuthCookie(secure: boolean): string {
  return `${EDIT_COOKIE}=; ${cookieExtras(secure, 0)}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return rest.join("=");
  }
  return null;
}

async function pruneSessions(): Promise<void> {
  await sql(`delete from edit_sessions where expires_at < now()`);
  const countRows = await sql<{ count: string }>(
    `select count(*)::text as count from edit_sessions`,
  );
  const count = Number(countRows[0]?.count ?? 0);
  if (count <= MAX_SESSIONS) return;
  const overflow = count - MAX_SESSIONS;
  await sql(
    `delete from edit_sessions
     where token_hash in (
       select token_hash from edit_sessions
       order by expires_at asc
       limit $1
     )`,
    [overflow],
  );
}

/** Opaque random session — not derived from the PIN. */
export async function createEditSession(): Promise<string> {
  await pruneSessions();
  const token = randomBytes(32).toString("base64url");
  await sql(
    `insert into edit_sessions (token_hash, expires_at)
     values ($1, now() + ($2 * interval '1 day'))`,
    [hashToken(token), SESSION_DAYS],
  );
  return token;
}

/**
 * Long-lived marker for a device that has entered the correct PIN before.
 * It grants no edit access by itself; it only gives that device its own
 * guess bucket, so a stranger tripping the global lockout can't block it.
 */
export const DEVICE_COOKIE = "ff_device";
const DEVICE_DAYS = 365;
const MAX_DEVICES = 50;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export function buildDeviceCookie(token: string, secure: boolean): string {
  return `${DEVICE_COOKIE}=${token}; ${cookieExtras(secure, DEVICE_DAYS * 24 * 60 * 60)}`;
}

/** Hash of the request's trusted-device token, or null if it isn't valid. */
export async function trustedDeviceHash(
  request: Request,
): Promise<string | null> {
  const token = readCookie(request, DEVICE_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const hash = hashToken(token);
  const rows = await sql<{ ok: number }>(
    `select 1 as ok from trusted_devices
     where token_hash = $1 and expires_at > now()
     limit 1`,
    [hash],
  );
  return rows.length > 0 ? hash : null;
}

/** Issue a new trusted-device token (keeping at most MAX_DEVICES). */
export async function createTrustedDevice(): Promise<string> {
  await sql(`delete from trusted_devices where expires_at < now()`);
  await sql(
    `delete from trusted_devices
     where token_hash in (
       select token_hash from trusted_devices
       order by expires_at desc
       offset $1
     )`,
    [MAX_DEVICES - 1],
  );
  const token = randomBytes(32).toString("base64url");
  await sql(
    `insert into trusted_devices (token_hash, expires_at)
     values ($1, now() + ($2 * interval '1 day'))`,
    [hashToken(token), DEVICE_DAYS],
  );
  return token;
}

export async function revokeEditSession(request: Request): Promise<void> {
  const token = readCookie(request, EDIT_COOKIE);
  if (!token) return;
  await sql(`delete from edit_sessions where token_hash = $1`, [
    hashToken(token),
  ]);
}

export async function isEditUnlocked(request: Request): Promise<boolean> {
  if (!pinConfigured()) return false;
  const token = readCookie(request, EDIT_COOKIE);
  if (!token || !TOKEN_PATTERN.test(token)) return false;
  const rows = await sql<{ ok: number }>(
    `select 1 as ok from edit_sessions
     where token_hash = $1 and expires_at > now()
     limit 1`,
    [hashToken(token)],
  );
  return rows.length > 0;
}

export function pinsMatch(submitted: unknown): boolean {
  const expected = getExpectedPin();
  if (!expected) return false;
  if (typeof submitted !== "string") return false;
  const pin = submitted.trim();
  if (!PIN_PATTERN.test(pin)) return false;
  const a = Buffer.from(pin, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

const MAX_BODY_BYTES = 4096;

/** Sent by the app's own fetches; other sites can't add it without CORS. */
export const WRITE_HEADER = "x-family-league";

/**
 * Writes must come from this app's own pages. The host proxy rewrites Host,
 * so compare nothing against it: refuse browsers that report a cross-site
 * request, and require the custom header, which forms and cross-origin
 * fetches cannot send (no CORS is allowed).
 */
export function assertSameOrigin(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (
    (site !== null && site !== "same-origin") ||
    request.headers.get(WRITE_HEADER) !== "1"
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

/**
 * Parse a small JSON body, streaming it and stopping as soon as it passes
 * MAX_BODY_BYTES. Returns null when missing, oversized, or invalid.
 */
export async function readSmallJson<T>(request: Request): Promise<T | null> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isFinite(length) || length < 0 || length > MAX_BODY_BYTES) {
      return null;
    }
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function requireEditAuth(
  request: Request,
): Promise<Response | null> {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  if (!pinConfigured()) {
    return NextResponse.json(
      { error: "Editing is not configured yet" },
      { status: 503 },
    );
  }
  if (await isEditUnlocked(request)) return null;
  return NextResponse.json(
    { error: "Enter the family PIN to edit" },
    { status: 401 },
  );
}
