import { NextResponse } from "next/server";
import { requireEditAuth } from "@/lib/edit-auth";
import { DreamTeamError, fetchDreamTeamPlayers } from "@/lib/dream-team";
import {
  ScoreRefreshError,
  buildScorePreview,
  claimRefreshSlot,
} from "@/lib/score-refresh";

export const dynamic = "force-dynamic";

const NOTHING_CHANGED = "No scores were changed.";

function failure(kind: string, error: string, status: number) {
  return NextResponse.json({ kind, error, detail: NOTHING_CHANGED }, { status });
}

/** Fetch Dream Team scores and return a preview. Never writes points. */
export async function POST(request: Request) {
  const authError = await requireEditAuth(request);
  if (authError) return authError;

  try {
    await claimRefreshSlot();
    const feed = await fetchDreamTeamPlayers();
    return NextResponse.json(await buildScorePreview(feed));
  } catch (error) {
    if (error instanceof DreamTeamError) {
      return error.kind === "unreachable"
        ? failure(
            "unreachable",
            "Couldn't reach Dream Team just now — their site may be busy or down. Try again in a few minutes.",
            502,
          )
        : failure(
            "bad_response",
            "Dream Team sent its data in a form this app doesn't recognise — their site may have changed.",
            502,
          );
    }
    if (error instanceof ScoreRefreshError) {
      return failure(
        error.kind,
        error.message,
        error.kind === "cooldown" ? 429 : 422,
      );
    }
    return failure("server", "Something went wrong checking scores.", 500);
  }
}
