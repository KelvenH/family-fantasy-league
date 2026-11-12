import { NextResponse } from "next/server";
import {
  assertSameOrigin,
  buildAuthCookie,
  clearAuthCookie,
  createEditSession,
  isEditUnlocked,
  pinConfigured,
  pinsMatch,
  requestIsSecure,
  revokeEditSession,
} from "@/lib/edit-auth";
import {
  getPinLockout,
  recordPinFailure,
  recordPinSuccess,
} from "@/lib/pin-rate-limit";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json({
    unlocked: await isEditUnlocked(request),
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
          "Editing is not configured yet. Add a 6–8 digit EDIT_PIN in Cursor Secrets.",
      },
      { status: 503 },
    );
  }

  const lockout = await getPinLockout();
  if (lockout.locked) {
    return NextResponse.json(
      {
        error: `Too many wrong PINs. Try again in ${lockout.retryAfterSec} seconds.`,
        retryAfterSec: lockout.retryAfterSec,
      },
      {
        status: 429,
        headers: { "Retry-After": String(lockout.retryAfterSec) },
      },
    );
  }

  try {
    const body = (await request.json()) as { pin?: unknown };
    if (!pinsMatch(body.pin)) {
      const failure = await recordPinFailure();
      if (failure.locked) {
        return NextResponse.json(
          {
            error: `Too many wrong PINs. Try again in ${failure.retryAfterSec} seconds.`,
            retryAfterSec: failure.retryAfterSec,
            attemptCount: failure.attemptCount,
          },
          {
            status: 429,
            headers: { "Retry-After": String(failure.retryAfterSec) },
          },
        );
      }
      return NextResponse.json(
        {
          error: "Wrong PIN. Try again.",
          attemptCount: failure.attemptCount,
        },
        { status: 401 },
      );
    }

    await recordPinSuccess();
    const token = await createEditSession();
    const response = NextResponse.json({
      unlocked: true,
      configured: true,
    });
    response.headers.set(
      "set-cookie",
      buildAuthCookie(token, requestIsSecure(request)),
    );
    return response;
  } catch {
    return NextResponse.json({ error: "Could not unlock" }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const originError = assertSameOrigin(request);
  if (originError) return originError;

  await revokeEditSession(request);
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
