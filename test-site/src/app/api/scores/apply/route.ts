import { NextResponse } from "next/server";
import { readSmallJson, requireEditAuth } from "@/lib/edit-auth";
import { ScoreRefreshError, applyScorePreview } from "@/lib/score-refresh";

export const dynamic = "force-dynamic";

/** Apply the scores from a preview returned by /api/scores/refresh. */
export async function POST(request: Request) {
  const authError = await requireEditAuth(request);
  if (authError) return authError;

  const body = await readSmallJson<{ previewId?: unknown }>(request);
  const previewId = body?.previewId;
  if (typeof previewId !== "string" || !/^[A-Za-z0-9_-]{10,64}$/.test(previewId)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    return NextResponse.json(await applyScorePreview(previewId));
  } catch (error) {
    if (error instanceof ScoreRefreshError) {
      return NextResponse.json(
        { kind: error.kind, error: error.message, detail: "No scores were changed." },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        kind: "server",
        error: "Scores couldn't be saved.",
        detail: "No scores were changed.",
      },
      { status: 500 },
    );
  }
}
