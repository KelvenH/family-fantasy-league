import { NextResponse } from "next/server";
import { requireEditAuth } from "@/lib/edit-auth";
import { updatePlayerPts } from "@/lib/league";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const authError = await requireEditAuth(request);
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      playerId?: unknown;
      pts?: unknown;
    };
    const playerId = Number(body.playerId);
    const pts = Number(body.pts);

    if (!Number.isInteger(playerId) || playerId <= 0) {
      return NextResponse.json({ error: "Invalid player" }, { status: 400 });
    }
    if (!Number.isInteger(pts) || pts < 0) {
      return NextResponse.json(
        { error: "Points must be a whole number 0 or more" },
        { status: 400 },
      );
    }

    const player = await updatePlayerPts(playerId, pts);
    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    return NextResponse.json({ player });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not update player",
      },
      { status: 500 },
    );
  }
}
