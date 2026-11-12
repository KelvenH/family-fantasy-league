import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const EDIT_COOKIE = "ff_edit";
/** Public apps need a long shared password — short digit PINs fail security review. */
export const MIN_PASS_LEN = 12;
export const MAX_PASS_LEN = 64;
const MAX_SESSIONS = 100;
const SESSION_HOURS = 12;

export function isValidPassphrase(value: string): boolean {
  if (value.length < MIN_PASS_LEN || value.length > MAX_PASS_LEN) return false;
  if (!/^[\x20-\x7E]+$/.test(value)) return false;
  const hasLetter = /[A-Za-z]/.test(value);
  const hasDigitOrSymbol = /[0-9]|[^A-Za-z0-9 ]/.test(value);
  return hasLetter && hasDigitOrSymbol;
}

export function getExpectedPassphrase(): string | null {
  const fromEnv = process.env.EDIT_PIN?.trim();
  if (fromEnv && isValidPassphrase(fromEnv)) return fromEnv;
  return null;
}

export function pinConfigured(): boolean {
  return getExpectedPassphrase() !== null;
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

/** Opaque random session — not derived from the password. */
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

export function passphrasesMatch(submitted: unknown): boolean {
  const expected = getExpectedPassphrase();
  if (!expected) return false;
  if (typeof submitted !== "string") return false;
  const value = submitted.trim();
  if (!isValidPassphrase(value)) return false;
  const a = Buffer.from(value, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** @deprecated use passphrasesMatch */
export function pinsMatch(submitted: unknown): boolean {
  return passphrasesMatch(submitted);
}

export function assertSameOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  const host = request.headers.get("host");
  if (!host) return null;
  try {
    if (new URL(origin).host !== host) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
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
    { error: "Enter the family password to edit" },
    { status: 401 },
  );
}
