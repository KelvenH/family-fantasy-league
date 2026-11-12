import { NextResponse } from "next/server";
import { requireEditAuth } from "@/lib/edit-auth";
import { updateTeamSlot } from "@/lib/league";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ name: string }>;
};

export async function PATCH(request: Request, { params }: Props) {
  const authError = requireEditAuth(request);
  if (authError) return authError;

  try {
    const { name: raw } = await params;
    const name = decodeURIComponent(raw);
    const body = (await request.json()) as {
      slotIndex?: unknown;
      playerId?: unknown;
    };
    const slotIndex = Number(body.slotIndex);
    const playerId =
      body.playerId === null || body.playerId === ""
        ? null
        : Number(body.playerId);

    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex > 10) {
      return NextResponse.json({ error: "Invalid slot" }, { status: 400 });
    }
    if (
      playerId !== null &&
      (!Number.isInteger(playerId) || playerId <= 0)
    ) {
      return NextResponse.json({ error: "Invalid player" }, { status: 400 });
    }

    const team = await updateTeamSlot(name, slotIndex, playerId);
    if (!team) {
      return NextResponse.json({ error: "Team not found" }, { status: 404 });
    }
    return NextResponse.json({ team });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Could not update team",
      },
      { status: 400 },
    );
  }
}
