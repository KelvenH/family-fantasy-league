import { NextResponse } from "next/server";
import { readSmallJson, requireEditAuth } from "@/lib/edit-auth";
import { LeagueInputError, updateTeamSlot } from "@/lib/league";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ name: string }>;
};

export async function PATCH(request: Request, { params }: Props) {
  const authError = await requireEditAuth(request);
  if (authError) return authError;

  const body = await readSmallJson<{ slotIndex?: unknown; playerId?: unknown }>(
    request,
  );
  if (!body) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  let name: string;
  try {
    name = decodeURIComponent((await params).name);
  } catch {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "Team not found" }, { status: 404 });
  }

  const slotIndex = Number(body.slotIndex);
  const playerId =
    body.playerId === null || body.playerId === ""
      ? null
      : Number(body.playerId);

  if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 10) {
    return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
  }
  if (playerId !== null && (!Number.isInteger(playerId) || playerId <= 0)) {
    return NextResponse.json({ error: "Invalid player" }, { status: 400 });
  }

  try {
    const team = await updateTeamSlot(name, slotIndex, playerId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    return NextResponse.json({ team });
  } catch (error) {
    if (error instanceof LeagueInputError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: "Could not update team" },
      { status: 500 },
    );
  }
}
