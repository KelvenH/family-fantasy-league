"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { EditUnlock } from "@/components/EditUnlock";
import { formatEditDate } from "@/lib/format";
import type { Player } from "@/lib/types";

type PreviewRow = {
  playerId: number;
  name: string;
  pos: string;
  club: string;
  currentPts: number;
  latestPts: number | null;
  status: "changed" | "same" | "unmatched";
  note: string | null;
};

type Preview = {
  previewId: string;
  fetchedAt: string;
  rows: PreviewRow[];
  counts: { changed: number; same: number; unmatched: number };
};

type Problem = { error: string; detail?: string };

type Props = {
  players: Player[];
  lastRefresh?: string;
};

const WRITE_HEADERS = {
  "content-type": "application/json",
  "x-family-league": "1",
};

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: WRITE_HEADERS,
      body: JSON.stringify(body ?? {}),
    });
  } catch {
    throw {
      error: "This device couldn't reach the league app.",
      detail: "Check your internet connection. No scores were changed.",
    } satisfies Problem;
  }
  const data = (await res.json().catch(() => ({}))) as T & Problem;
  if (res.status === 401) {
    throw {
      error: "Your edit session has ended.",
      detail: "Reload the page and enter the family PIN again. No scores were changed.",
    } satisfies Problem;
  }
  if (!res.ok) {
    throw {
      error: data.error || "Something went wrong.",
      detail: data.detail ?? "No scores were changed.",
    } satisfies Problem;
  }
  return data;
}

function asProblem(err: unknown): Problem {
  if (err && typeof err === "object" && "error" in err) return err as Problem;
  return { error: "Something went wrong.", detail: "No scores were changed." };
}

export function PlayersAdmin({ players: initial, lastRefresh: initialRefresh }: Props) {
  const [players, setPlayers] = useState(initial);
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(initial.map((player) => [player.id, String(player.pts)])),
  );
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lastRefresh, setLastRefresh] = useState(initialRefresh);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState("");
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function resetMessages() {
    setMessage("");
    setProblem(null);
  }

  function showPlayers(next: Player[]) {
    setPlayers(next);
    setDrafts(Object.fromEntries(next.map((p) => [p.id, String(p.pts)])));
  }

  function refreshScores() {
    resetMessages();
    setBusy("Checking Dream Team for the latest scores…");
    startTransition(async () => {
      try {
        setPreview(await postJson<Preview>("/api/scores/refresh"));
      } catch (err) {
        setProblem(asProblem(err));
      } finally {
        setBusy("");
      }
    });
  }

  function applyScores() {
    if (!preview) return;
    resetMessages();
    setBusy("Applying scores…");
    startTransition(async () => {
      try {
        const result = await postJson<{
          applied: number;
          skipped: string[];
          players: Player[];
        }>("/api/scores/apply", { previewId: preview.previewId });
        showPlayers(result.players);
        setLastRefresh(new Date().toISOString());
        setPreview(null);
        const skipped = result.skipped.length
          ? ` Skipped ${result.skipped.join(", ")} because their points were changed by hand after the refresh.`
          : "";
        router.refresh();
        setMessage(
          `Applied ${result.applied} new score${result.applied === 1 ? "" : "s"}.${skipped}`,
        );
      } catch (err) {
        setProblem(asProblem(err));
      } finally {
        setBusy("");
      }
    });
  }

  function cancelPreview() {
    setPreview(null);
    resetMessages();
    setMessage("Cancelled — no scores were changed.");
  }

  function savePts(playerId: number) {
    const raw = drafts[playerId] ?? "";
    const pts = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(pts) || pts < -100 || pts > 10000) {
      setProblem({ error: "Points must be a whole number from -100 to 10000." });
      return;
    }

    resetMessages();
    startTransition(async () => {
      try {
        const res = await fetch("/api/players", {
          method: "PATCH",
          credentials: "same-origin",
          headers: WRITE_HEADERS,
          body: JSON.stringify({ playerId, pts }),
        });
        const data = (await res.json()) as { player?: Player; error?: string };
        if (!res.ok || !data.player) {
          throw new Error(data.error || "Could not save points");
        }
        const saved = data.player;
        setPlayers((prev) => prev.map((p) => (p.id === saved.id ? saved : p)));
        setDrafts((prev) => ({ ...prev, [saved.id]: String(saved.pts) }));
        router.refresh();
        setMessage(`Saved ${saved.name}: ${saved.pts} pts`);
      } catch (err) {
        setProblem({
          error: err instanceof Error ? err.message : "Could not save points",
        });
      }
    });
  }

  const status = (
    <>
      {problem ? (
        <div className="notice error" role="alert">
          <strong>{problem.error}</strong>
          {problem.detail ? <div>{problem.detail}</div> : null}
          <div className="meta">You can still update scores by hand below.</div>
        </div>
      ) : null}
      <div className="status" aria-live="polite">
        {busy || (pending ? "Saving…" : message)}
      </div>
    </>
  );

  return (
    <EditUnlock title="Enter the family PIN to view and edit players" description="">
      <div className="refresh-bar">
        <button
          className="btn"
          type="button"
          disabled={pending || preview !== null}
          onClick={refreshScores}
        >
          Refresh scores
        </button>
        <span className="meta">
          Last refreshed from Dream Team: {formatEditDate(lastRefresh)}
        </span>
      </div>

      {status}

      {preview ? (
        <div className="preview">
          <h2>Latest scores from Dream Team</h2>
          <p className="lede">
            {preview.counts.changed} player
            {preview.counts.changed === 1 ? " has a" : "s have"} new scores,{" "}
            {preview.counts.same} unchanged
            {preview.counts.unmatched
              ? `, ${preview.counts.unmatched} not found (kept as they are)`
              : ""}
            . Nothing is saved until you tap Apply scores.
          </p>
          <div className="preview-actions">
            <button
              className="btn"
              type="button"
              disabled={pending || preview.counts.changed === 0}
              onClick={applyScores}
            >
              Apply scores
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={pending}
              onClick={cancelPreview}
            >
              Cancel
            </button>
          </div>

          <div className="player-row preview-head">
            <div>Player</div>
            <div className="hide-sm">Club</div>
            <div>Now</div>
            <div>Latest</div>
          </div>
          {preview.rows.map((row) => (
            <div className={`player-row preview-row ${row.status}`} key={row.playerId}>
              <div>
                <strong>{row.name}</strong>
                <div className="meta">
                  {row.pos} · {row.club}
                  {row.note ? ` · ${row.note}` : ""}
                </div>
              </div>
              <div className="hide-sm">{row.club}</div>
              <div className="num">{row.currentPts}</div>
              <div className="num">
                {row.latestPts === null ? "—" : row.latestPts}
                {row.status === "changed" && row.latestPts !== null ? (
                  <span className="delta">
                    {" "}
                    ({row.latestPts > row.currentPts ? "+" : ""}
                    {row.latestPts - row.currentPts})
                  </span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <p className="lede">
            Change a player&apos;s points, then tap Save. Team totals update from
            these points automatically.
          </p>
          <div className="player-row" style={{ color: "var(--muted)", fontSize: "0.92rem" }}>
            <div>Player</div>
            <div className="hide-sm">Pos</div>
            <div className="hide-sm">Club</div>
            <div className="hide-sm">£m</div>
            <div>Points</div>
            <div></div>
          </div>

          {players.map((player) => (
            <div className="player-row" key={player.id}>
              <div>
                <strong>{player.name}</strong>
                <div className="meta">
                  {player.pos} · {player.club} · £{player.price.toFixed(1)}m
                </div>
              </div>
              <div className="hide-sm">{player.pos}</div>
              <div className="hide-sm">{player.club}</div>
              <div className="hide-sm num">{player.price.toFixed(1)}</div>
              <div>
                <input
                  className="pts-input"
                  inputMode="numeric"
                  aria-label={`Points for ${player.name}`}
                  value={drafts[player.id] ?? ""}
                  disabled={pending}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [player.id]: event.target.value }))
                  }
                />
              </div>
              <div>
                <button
                  className="btn"
                  type="button"
                  disabled={pending}
                  onClick={() => savePts(player.id)}
                >
                  Save
                </button>
              </div>
            </div>
          ))}
        </>
      )}
    </EditUnlock>
  );
}
