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
import { applyPinGuess, FAIL_DELAY_MS } from "@/lib/pin-rate-limit";

export const dynamic = "force-dynamic";

function withCookies(
  response: NextResponse,
  cookies: Array<string | null | undefined>,
): NextResponse {
  for (const cookie of cookies) {
    if (cookie) response.headers.append("set-cookie", cookie);
  }
  return response;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

  try {
    const body = (await request.json()) as { pin?: unknown };
    const pinOk = pinsMatch(body.pin);

    // One global transactional step — not keyed on cookies or client IP.
    const result = await applyPinGuess(pinOk);

    if (result.status === "locked") {
      await delay(FAIL_DELAY_MS);
      return NextResponse.json(
        {
          error: `Too many wrong PINs. Try again in ${result.retryAfterSec} seconds.`,
          retryAfterSec: result.retryAfterSec,
          attemptCount: result.attemptCount,
        },
        {
          status: 429,
          headers: { "Retry-After": String(result.retryAfterSec) },
        },
      );
    }

    if (result.status === "rejected") {
      await delay(FAIL_DELAY_MS);
      return NextResponse.json(
        {
          error: "Wrong PIN. Try again.",
          attemptCount: result.attemptCount,
        },
        { status: 401 },
      );
    }

    const token = await createEditSession();
    return withCookies(
      NextResponse.json({
        unlocked: true,
        configured: true,
      }),
      [buildAuthCookie(token, requestIsSecure(request))],
    );
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
