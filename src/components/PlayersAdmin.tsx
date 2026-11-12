"use client";

import { useState, useTransition } from "react";
import type { Player } from "@/lib/types";

type Props = {
  players: Player[];
};

export function PlayersAdmin({ players: initial }: Props) {
  const [players, setPlayers] = useState(initial);
  const [drafts, setDrafts] = useState<Record<number, string>>(() =>
    Object.fromEntries(initial.map((player) => [player.id, String(player.pts)])),
  );
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function savePts(playerId: number) {
    const raw = drafts[playerId] ?? "";
    const pts = Number(raw);
    if (!Number.isFinite(pts) || pts < 0 || !Number.isInteger(pts)) {
      setError("Points must be a whole number 0 or more.");
      return;
    }

    startTransition(async () => {
      setMessage("");
      setError("");
      try {
        const res = await fetch("/api/players", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ playerId, pts }),
        });
        const data = (await res.json()) as {
          player?: Player;
          error?: string;
        };
        if (!res.ok || !data.player) {
          throw new Error(data.error || "Could not save points");
        }
        setPlayers((prev) =>
          prev.map((player) =>
            player.id === data.player!.id ? data.player! : player,
          ),
        );
        setDrafts((prev) => ({
          ...prev,
          [data.player!.id]: String(data.player!.pts),
        }));
        setMessage(`Saved ${data.player.name}: ${data.player.pts} pts`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save points");
      }
    });
  }

  return (
    <div>
      <p className="lede">
        Change a player&apos;s points, then tap Save. Team totals update from
        these points automatically.
      </p>
      <div className={`status${error ? " error" : ""}`} aria-live="polite">
        {pending ? "Saving…" : error || message}
      </div>

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
                setDrafts((prev) => ({
                  ...prev,
                  [player.id]: event.target.value,
                }))
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
    </div>
  );
}
