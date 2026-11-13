import { randomBytes } from "node:crypto";
import { sql, withTransaction } from "@/lib/db";
import type { DreamTeamPlayer } from "@/lib/dream-team";
import { listPlayers } from "@/lib/league";
import type { Player } from "@/lib/types";

export type PreviewStatus = "changed" | "same" | "unmatched";

export type PreviewRow = {
  playerId: number;
  name: string;
  pos: string;
  club: string;
  currentPts: number;
  latestPts: number | null;
  status: PreviewStatus;
  /** Plain-English detail, e.g. "Not found on Dream Team — stays at 0". */
  note: string | null;
};

export type ScorePreview = {
  previewId: string;
  fetchedAt: string;
  rows: PreviewRow[];
  counts: Record<PreviewStatus, number>;
};

/** Below this share of matched players the feed is treated as broken. */
const MIN_MATCH_SHARE = 0.5;
const PREVIEW_MINUTES = 30;
const REFRESH_COOLDOWN_SEC = 15;

export class ScoreRefreshError extends Error {
  constructor(
    readonly kind: "too_few_matches" | "cooldown" | "expired",
    message: string,
  ) {
    super(message);
  }
}

function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z.' -]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchPlayer(
  player: Player,
  byName: Map<string, DreamTeamPlayer[]>,
): { match: DreamTeamPlayer | null; note: string | null } {
  const candidates = byName.get(normaliseName(player.name)) ?? [];
  const sameClub = candidates.filter((c) => c.club === player.club);
  if (sameClub.length === 1) return { match: sameClub[0]!, note: null };

  // A move to another Premier League club keeps scoring under a new club code.
  const samePos = candidates.filter((c) => c.position === player.pos);
  if (sameClub.length === 0 && samePos.length === 1) {
    const moved = samePos[0]!;
    return { match: moved, note: `Now listed at ${moved.club}` };
  }
  if (candidates.length > 1) {
    return {
      match: null,
      note: "More than one Dream Team player has this name — update by hand",
    };
  }
  return {
    match: null,
    note: `Not found on Dream Team — stays at ${player.pts}`,
  };
}

export async function buildScorePreview(
  feed: DreamTeamPlayer[],
): Promise<ScorePreview> {
  const byName = new Map<string, DreamTeamPlayer[]>();
  for (const item of feed) {
    for (const key of new Set(item.names.map(normaliseName))) {
      byName.set(key, [...(byName.get(key) ?? []), item]);
    }
  }

  const players = await listPlayers();
  const rows: PreviewRow[] = players.map((player) => {
    const { match, note } = matchPlayer(player, byName);
    const latestPts = match ? match.totalPoints : null;
    let status: PreviewStatus = "unmatched";
    if (latestPts !== null) {
      status = latestPts === player.pts ? "same" : "changed";
    }
    const lower =
      latestPts !== null && latestPts < player.pts
        ? "Lower than before — check before applying"
        : null;
    return {
      playerId: player.id,
      name: player.name,
      pos: player.pos,
      club: player.club,
      currentPts: player.pts,
      latestPts,
      status,
      note: [note, lower].filter(Boolean).join(". ") || null,
    };
  });

  const counts = { changed: 0, same: 0, unmatched: 0 };
  for (const row of rows) counts[row.status] += 1;

  const matched = counts.changed + counts.same;
  if (players.length > 0 && matched / players.length < MIN_MATCH_SHARE) {
    throw new ScoreRefreshError(
      "too_few_matches",
      `Only ${matched} of ${players.length} players could be matched on Dream Team, which looks wrong, so no scores were offered.`,
    );
  }

  const previewId = randomBytes(16).toString("base64url");
  await sql(`delete from score_previews`);
  await sql(`insert into score_previews (id, rows) values ($1, $2::jsonb)`, [
    previewId,
    JSON.stringify(rows),
  ]);

  return {
    previewId,
    fetchedAt: new Date().toISOString(),
    rows,
    counts,
  };
}

/** One refresh at a time for the whole app, at most every few seconds. */
export async function claimRefreshSlot(): Promise<void> {
  const rows = await sql<{ value: string }>(
    `insert into app_meta (key, value) values ('last_refresh_attempt', $1)
     on conflict (key) do update set value = excluded.value
     where app_meta.value::timestamptz < now() - ($2 * interval '1 second')
     returning value`,
    [new Date().toISOString(), REFRESH_COOLDOWN_SEC],
  );
  if (rows.length === 0) {
    throw new ScoreRefreshError(
      "cooldown",
      "Scores were refreshed a moment ago. Please wait a few seconds and try again.",
    );
  }
}

export type ApplyResult = {
  applied: number;
  skipped: string[];
  players: Player[];
};

/**
 * Apply a stored preview. A player whose points were changed by hand after
 * the refresh is skipped rather than overwritten.
 */
export async function applyScorePreview(
  previewId: string,
): Promise<ApplyResult> {
  const result = await withTransaction(async (query) => {
    const previews = await query<{ rows: PreviewRow[] | string }>(
      `delete from score_previews
       where id = $1 and created_at > now() - ($2 * interval '1 minute')
       returning rows`,
      [previewId, PREVIEW_MINUTES],
    );
    const stored = previews[0];
    if (!stored) {
      throw new ScoreRefreshError(
        "expired",
        "That preview has expired or was already used. Tap Refresh scores again.",
      );
    }
    const rows: PreviewRow[] =
      typeof stored.rows === "string" ? JSON.parse(stored.rows) : stored.rows;

    let applied = 0;
    const skipped: string[] = [];
    for (const row of rows) {
      if (row.status !== "changed" || row.latestPts === null) continue;
      const updated = await query(
        `update players set pts = $2 where id = $1 and pts = $3 returning id`,
        [row.playerId, row.latestPts, row.currentPts],
      );
      if (updated.length > 0) applied += 1;
      else skipped.push(row.name);
    }

    const now = new Date().toISOString();
    await query(
      `insert into app_meta (key, value) values ('last_scores_refresh', $1)
       on conflict (key) do update set value = excluded.value`,
      [now],
    );
    if (applied > 0) {
      await query(
        `insert into app_meta (key, value) values ('last_points_edit', $1)
         on conflict (key) do update set value = excluded.value`,
        [now],
      );
    }
    return { applied, skipped };
  });

  return { ...result, players: await listPlayers() };
}
