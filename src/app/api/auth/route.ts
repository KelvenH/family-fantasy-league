import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  buildAuthCookie,
  clearAuthCookie,
  isEditUnlocked,
  pinConfigured,
  pinsMatch,
  requestIsSecure,
} from "@/lib/edit-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    unlocked: isEditUnlocked(request),
    configured: pinConfigured(),
  });
}

export async function POST(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  if (!pinConfigured()) {
    return NextResponse.json(
      {
        error:
          "Editing is not configured yet. Add EDIT_PIN in Cursor Secrets.",
      },
      { status: 503 },
    );
  }

  try {
    const body = (await request.json()) as { pin?: unknown };
    if (!pinsMatch(body.pin)) {
      return NextResponse.json(
        { error: "Wrong PIN. Try again." },
        { status: 401 },
      );
    }

    const cookie = buildAuthCookie(requestIsSecure(request));
    if (!cookie) {
      return NextResponse.json(
        { error: "Editing is not configured yet" },
        { status: 503 },
      );
    }

    const response = NextResponse.json({
      unlocked: true,
      configured: true,
    });
    response.headers.set("set-cookie", cookie);
    return response;
  } catch {
    return NextResponse.json({ error: "Could not unlock" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  const response = NextResponse.json({
    unlocked: false,
    configured: pinConfigured(),
  });
  response.headers.set(
    "set-cookie",
    clearAuthCookie(requestIsSecure(request)),
  );
  return response;
}
