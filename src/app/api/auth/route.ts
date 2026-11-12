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
  resolveRateClient,
} from "@/lib/pin-rate-limit";

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

  const { clientId, rateCookieToSet } = resolveRateClient(request);

  const lockout = await getPinLockout(clientId);
  if (lockout.locked) {
    return withCookies(
      NextResponse.json(
        {
          error: `Too many wrong PINs. Try again in ${lockout.retryAfterSec} seconds.`,
          retryAfterSec: lockout.retryAfterSec,
        },
        {
          status: 429,
          headers: { "Retry-After": String(lockout.retryAfterSec) },
        },
      ),
      [rateCookieToSet],
    );
  }

  try {
    const body = (await request.json()) as { pin?: unknown };
    if (!pinsMatch(body.pin)) {
      // Atomic increment+lock — parallel guesses cannot bypass the attempt limit.
      const failure = await recordPinFailure(clientId);
      if (failure.locked) {
        return withCookies(
          NextResponse.json(
            {
              error: `Too many wrong PINs. Try again in ${failure.retryAfterSec} seconds.`,
              retryAfterSec: failure.retryAfterSec,
              attemptCount: failure.attemptCount,
            },
            {
              status: 429,
              headers: { "Retry-After": String(failure.retryAfterSec) },
            },
          ),
          [rateCookieToSet],
        );
      }
      return withCookies(
        NextResponse.json(
          {
            error: "Wrong PIN. Try again.",
            attemptCount: failure.attemptCount,
          },
          { status: 401 },
        ),
        [rateCookieToSet],
      );
    }

    await recordPinSuccess(clientId);
    const token = await createEditSession();
    return withCookies(
      NextResponse.json({
        unlocked: true,
        configured: true,
      }),
      [
        buildAuthCookie(token, requestIsSecure(request)),
        rateCookieToSet,
      ],
    );
  } catch {
    return withCookies(
      NextResponse.json({ error: "Could not unlock" }, { status: 400 }),
      [rateCookieToSet],
    );
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
