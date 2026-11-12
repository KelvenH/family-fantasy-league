import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const EDIT_COOKIE = "ff_edit";
const TOKEN_PAYLOAD = "family-fantasy-edit-v1";

export function getExpectedPin(): string | null {
  const fromEnv = process.env.EDIT_PIN?.trim();
  if (fromEnv && /^\d{4,8}$/.test(fromEnv)) return fromEnv;
  return null;
}

export function pinConfigured(): boolean {
  return getExpectedPin() !== null;
}

function tokenFor(pin: string): string {
  return createHmac("sha256", pin).update(TOKEN_PAYLOAD).digest("hex");
}

export function requestIsSecure(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === "https:") return true;
  const proto = request.headers.get("x-forwarded-proto");
  return proto?.split(",")[0]?.trim() === "https";
}

function cookieExtras(secure: boolean): string {
  const parts = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=2592000"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function buildAuthCookie(secure: boolean): string | null {
  const pin = getExpectedPin();
  if (!pin) return null;
  return `${EDIT_COOKIE}=${tokenFor(pin)}; ${cookieExtras(secure)}`;
}

export function clearAuthCookie(secure: boolean): string {
  const parts = [
    `${EDIT_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return rest.join("=");
  }
  return null;
}

export function isEditUnlocked(request: Request): boolean {
  const pin = getExpectedPin();
  if (!pin) return false;
  const value = readCookie(request, EDIT_COOKIE);
  if (!value) return false;
  const expected = Buffer.from(tokenFor(pin), "utf8");
  const got = Buffer.from(value, "utf8");
  if (expected.length !== got.length) return false;
  return timingSafeEqual(expected, got);
}

export function pinsMatch(submitted: unknown): boolean {
  const expected = getExpectedPin();
  if (!expected) return false;
  if (typeof submitted !== "string") return false;
  const pin = submitted.trim();
  if (!/^\d{4,8}$/.test(pin)) return false;
  const a = Buffer.from(pin, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
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

export function requireEditAuth(request: Request): Response | null {
  const originError = assertSameOrigin(request);
  if (originError) return originError;
  if (!pinConfigured()) {
    return NextResponse.json(
      { error: "Editing is not configured yet" },
      { status: 503 },
    );
  }
  if (isEditUnlocked(request)) return null;
  return NextResponse.json(
    { error: "Enter the family PIN to edit" },
    { status: 401 },
  );
}
