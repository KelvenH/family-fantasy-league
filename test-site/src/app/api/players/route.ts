import { NextResponse } from "next/server";
import { readSmallJson, requireEditAuth } from "@/lib/edit-auth";
import { updatePlayerPts } from "@/lib/league";

export const dynamic = "force-dynamic";

const MIN_PTS = -100;
const MAX_PTS = 10000;

export async function PATCH(request: Request) {
  const authError = await requireEditAuth(request);
  if (authError) return authError;

  const body = await readSmallJson<{ playerId?: unknown; pts?: unknown }>(
    request,
  );
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const playerId = Number(body.playerId);
  const pts = Number(body.pts);

  if (!Number.isInteger(playerId) || playerId <= 0) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }
  if (!Number.isInteger(pts) || pts < MIN_PTS || pts > MAX_PTS) {
    return NextResponse.json(
      { error: `Points must be a whole number from ${MIN_PTS} to ${MAX_PTS}` },
      { status: 400 },
    );
  }

  try {
    const player = await updatePlayerPts(playerId, pts);
    if (!player) {
      return NextResponse.json({ error: "Player not found" }, { status: 404 });
    }
    return NextResponse.json({ player });
  } catch {
    return NextResponse.json(
      { error: "Could not update player" },
      { status: 500 },
    );
  }
}
