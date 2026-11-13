import { readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "./db";
import { SLOT_POSITIONS } from "./types";

type SeedPlayer = {
  name: string;
  pos: string;
  club: string;
  price: number;
  pts: number;
};

type SeedTeam = {
  name: string;
  players: Array<{
    pos: string;
    name: string;
    club: string;
    price: number;
    pts: number;
  }>;
};

type SeedMeta = {
  exportedAt?: string;
  playersCatalogueNote?: string;
  sourceWorkbook?: string;
};

let seedPromise: Promise<void> | undefined;

export async function ensureSeeded(): Promise<void> {
  seedPromise ??= runSeed().catch((error: unknown) => {
    seedPromise = undefined;
    throw error;
  });
  await seedPromise;
}

async function runSeed(): Promise<void> {
  const existing = await sql<{ count: string }>(
    "select count(*)::text as count from teams",
  );
  if (Number(existing[0]?.count ?? 0) > 0) {
    return;
  }

  const dataDir = path.join(process.cwd(), "src", "seed-data");
  let players: SeedPlayer[];
  let teams: SeedTeam[];
  let meta: SeedMeta = {};

  try {
    players = JSON.parse(
      await readFile(path.join(dataDir, "players.json"), "utf8"),
    ) as SeedPlayer[];
    teams = JSON.parse(
      await readFile(path.join(dataDir, "teams.json"), "utf8"),
    ) as SeedTeam[];
    meta = JSON.parse(
      await readFile(path.join(dataDir, "meta.json"), "utf8"),
    ) as SeedMeta;
  } catch {
    await sql(
      `insert into app_meta (key, value) values ($1, $2)
       on conflict (key) do update set value = excluded.value`,
      ["status", "waiting_for_data"],
    );
    return;
  }

  for (const player of players) {
    await sql(
      `insert into players (name, pos, club, price, pts)
       values ($1, $2, $3, $4, $5)
       on conflict (name) do update set
         pos = excluded.pos,
         club = excluded.club,
         price = excluded.price,
         pts = excluded.pts`,
      [player.name, player.pos, player.club, player.price, player.pts],
    );
  }

  const playerRows = await sql<{ id: number; name: string }>(
    "select id, name from players",
  );
  const playerIds = new Map(playerRows.map((row) => [row.name, row.id]));

  for (const team of teams) {
    const inserted = await sql<{ id: number }>(
      `insert into teams (name) values ($1)
       on conflict (name) do update set name = excluded.name
       returning id`,
      [team.name],
    );
    const teamId = inserted[0]!.id;

    for (let i = 0; i < SLOT_POSITIONS.length; i += 1) {
      const slotPos = SLOT_POSITIONS[i]!;
      const pick = team.players[i];
      const playerId = pick ? (playerIds.get(pick.name) ?? null) : null;
      await sql(
        `insert into team_slots (team_id, slot_index, slot_pos, player_id)
         values ($1, $2, $3, $4)
         on conflict (team_id, slot_index) do update set
           slot_pos = excluded.slot_pos,
           player_id = excluded.player_id`,
        [teamId, i, slotPos, playerId],
      );
    }
  }

  await sql(
    `insert into app_meta (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    ["status", "ready"],
  );
  await sql(
    `insert into app_meta (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    ["exported_at", meta.exportedAt ?? ""],
  );
  await sql(
    `insert into app_meta (key, value) values ($1, $2)
     on conflict (key) do update set value = excluded.value`,
    ["catalogue_note", meta.playersCatalogueNote ?? ""],
  );
}
