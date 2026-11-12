import { sql } from "./db";
import { ensureSeeded } from "./seed";
import {
  POS_ORDER,
  type Player,
  type Position,
  type TeamDetail,
  type TeamSlot,
  type TeamStanding,
} from "./types";

export async function getMeta(): Promise<Record<string, string>> {
  await ensureSeeded();
  const rows = await sql<{ key: string; value: string }>(
    "select key, value from app_meta",
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function listStandings(): Promise<TeamStanding[]> {
  await ensureSeeded();
  const rows = await sql<{
    id: number;
    name: string;
    total_pts: string | number;
    total_price: string | number;
  }>(
    `select
       t.id,
       t.name,
       coalesce(sum(p.pts), 0) as total_pts,
       coalesce(sum(p.price), 0) as total_price
     from teams t
     left join team_slots s on s.team_id = t.id
     left join players p on p.id = s.player_id
     group by t.id, t.name
     order by total_pts desc, t.name asc`,
  );

  return rows.map((row, index) => ({
    id: row.id,
    name: row.name,
    totalPts: Number(row.total_pts),
    totalPrice: Number(row.total_price),
    rank: index + 1,
  }));
}

export async function getTeamByName(name: string): Promise<TeamDetail | null> {
  await ensureSeeded();
  const teams = await sql<{ id: number; name: string }>(
    "select id, name from teams where name = $1",
    [name],
  );
  const team = teams[0];
  if (!team) return null;

  const slots = await sql<{
    slot_index: number;
    slot_pos: string;
    player_id: number | null;
    player_name: string | null;
    club: string | null;
    price: string | number | null;
    pts: number | null;
  }>(
    `select
       s.slot_index,
       s.slot_pos,
       s.player_id,
       p.name as player_name,
       p.club,
       p.price,
       p.pts
     from team_slots s
     left join players p on p.id = s.player_id
     where s.team_id = $1
     order by s.slot_index asc`,
    [team.id],
  );

  const mapped: TeamSlot[] = slots.map((slot) => ({
    slotIndex: slot.slot_index,
    slotPos: slot.slot_pos as Position,
    playerId: slot.player_id,
    playerName: slot.player_name,
    club: slot.club,
    price: slot.price == null ? null : Number(slot.price),
    pts: slot.pts,
  }));

  return {
    id: team.id,
    name: team.name,
    totalPts: mapped.reduce((sum, slot) => sum + (slot.pts ?? 0), 0),
    totalPrice: mapped.reduce((sum, slot) => sum + (slot.price ?? 0), 0),
    slots: mapped,
  };
}

export async function listPlayers(): Promise<Player[]> {
  await ensureSeeded();
  const rows = await sql<{
    id: number;
    name: string;
    pos: string;
    club: string;
    price: string | number;
    pts: number;
  }>("select id, name, pos, club, price, pts from players");

  return rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      pos: row.pos as Position,
      club: row.club,
      price: Number(row.price),
      pts: row.pts,
    }))
    .sort((a, b) => {
      const posDiff = (POS_ORDER[a.pos] ?? 99) - (POS_ORDER[b.pos] ?? 99);
      if (posDiff !== 0) return posDiff;
      return a.name.localeCompare(b.name);
    });
}

export async function listPlayersByPos(pos: string): Promise<Player[]> {
  const players = await listPlayers();
  return players.filter((player) => player.pos === pos);
}

/** Validation failure whose message is safe to show to the visitor. */
export class LeagueInputError extends Error {}

export async function updatePlayerPts(
  playerId: number,
  pts: number,
): Promise<Player | null> {
  await ensureSeeded();
  const rows = await sql<{
    id: number;
    name: string;
    pos: string;
    club: string;
    price: string | number;
    pts: number;
  }>(
    `update players
     set pts = $2
     where id = $1
     returning id, name, pos, club, price, pts`,
    [playerId, pts],
  );
  const row = rows[0];
  if (!row) return null;
  await sql(
    `insert into app_meta (key, value) values ('last_points_edit', $1)
     on conflict (key) do update set value = excluded.value`,
    [new Date().toISOString()],
  );
  return {
    id: row.id,
    name: row.name,
    pos: row.pos as Position,
    club: row.club,
    price: Number(row.price),
    pts: row.pts,
  };
}

export async function updateTeamSlot(
  teamName: string,
  slotIndex: number,
  playerId: number | null,
): Promise<TeamDetail | null> {
  await ensureSeeded();
  const teams = await sql<{ id: number }>(
    "select id from teams where name = $1",
    [teamName],
  );
  const team = teams[0];
  if (!team) return null;

  const slots = await sql<{ slot_pos: string }>(
    "select slot_pos from team_slots where team_id = $1 and slot_index = $2",
    [team.id, slotIndex],
  );
  const slot = slots[0];
  if (!slot) return null;

  if (playerId != null) {
    const players = await sql<{ id: number; pos: string }>(
      "select id, pos from players where id = $1",
      [playerId],
    );
    const player = players[0];
    if (!player) {
      throw new LeagueInputError("Player not found");
    }
    // Allow keeping an existing off-position pick; new picks must match the slot.
    const existing = await sql<{ player_id: number | null }>(
      "select player_id from team_slots where team_id = $1 and slot_index = $2",
      [team.id, slotIndex],
    );
    const keepingCurrent = existing[0]?.player_id === playerId;
    if (!keepingCurrent && player.pos !== slot.slot_pos) {
      throw new LeagueInputError(
        `Player position ${player.pos} does not match slot ${slot.slot_pos}`,
      );
    }
  }

  await sql(
    "update team_slots set player_id = $1 where team_id = $2 and slot_index = $3",
    [playerId, team.id, slotIndex],
  );

  return getTeamByName(teamName);
}
