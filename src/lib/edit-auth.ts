import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const EDIT_COOKIE = "ff_edit";
/** Simple family PIN: 6–8 digits. Brute force is blocked by hard server-side rate limits. */
export const PIN_PATTERN = /^\d{6,8}$/;
const MAX_SESSIONS = 100;
const SESSION_HOURS = 12;

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
  return `${EDIT_COOKIE}=${token}; ${cookieExtras(secure, SESSION_HOURS * 60 * 60)}`;
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
     values ($1, now() + interval '12 hours')`,
    [hashToken(token)],
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
  if (!token || !/^[A-Za-z0-9_-]{20,128}$/.test(token)) return false;
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

/**
 * Writes must come from this app's own pages: browsers always send Origin on
 * POST/PATCH/DELETE, so a missing or foreign Origin is refused.
 */
export function assertSameOrigin(request: Request): Response | null {
  const forbidden = () =>
    NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = request.headers.get("origin");
  if (!origin) {
    return request.headers.get("sec-fetch-site") === "same-origin"
      ? null
      : forbidden();
  }
  const hosts = [
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim(),
    request.headers.get("host"),
    new URL(request.url).host,
  ].filter(Boolean);
  try {
    return hosts.includes(new URL(origin).host) ? null : forbidden();
  } catch {
    return forbidden();
  }
}

/** Parse a small JSON body; returns null when missing, oversized, or invalid. */
export async function readSmallJson<T>(request: Request): Promise<T | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
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
