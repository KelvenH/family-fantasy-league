"use client";

import { useMemo, useState, useTransition } from "react";
import { EditUnlock } from "@/components/EditUnlock";
import type { Player, TeamDetail } from "@/lib/types";

type Props = {
  team: TeamDetail;
  players: Player[];
};

export function TeamEditor({ team, players }: Props) {
  const [current, setCurrent] = useState(team);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  const byPos = useMemo(() => {
    const map = new Map<string, Player[]>();
    for (const player of players) {
      const list = map.get(player.pos) ?? [];
      list.push(player);
      map.set(player.pos, list);
    }
    return map;
  }, [players]);

  function onChangeSlot(slotIndex: number, value: string) {
    startTransition(async () => {
      setMessage("");
      setError("");
      try {
        const res = await fetch(
          `/api/teams/${encodeURIComponent(current.name)}`,
          {
            method: "PATCH",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              slotIndex,
              playerId: value === "" ? null : Number(value),
            }),
          },
        );
        const data = (await res.json()) as {
          team?: TeamDetail;
          error?: string;
        };
        if (!res.ok || !data.team) {
          throw new Error(data.error || "Could not update pick");
        }
        setCurrent(data.team);
        setMessage("Pick saved.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update pick");
      }
    });
  }

  return (
    <div>
      <div className="totals">
        <div className="total-chip">
          Total points
          <strong>{current.totalPts}</strong>
        </div>
        <div className="total-chip">
          Squad value
          <strong>£{current.totalPrice.toFixed(1)}m</strong>
        </div>
      </div>

      <EditUnlock
        title="Enter the family password to change picks"
        lockedFallback={
          <div className="slot-list">
            {current.slots.map((slot) => (
              <div className="slot-card" key={slot.slotIndex}>
                <div className="slot-pos">{slot.slotPos}</div>
                <div className="slot-body">
                  <div className="meta">Pick {slot.slotIndex + 1}</div>
                  <strong>
                    {slot.playerName ?? "No player selected"}
                  </strong>
                  <div className="slot-meta">
                    {slot.playerName
                      ? `${slot.club ?? ""} · ${slot.pts ?? 0} pts · £${(slot.price ?? 0).toFixed(1)}m`
                      : "Unlock with the family password to change this pick"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        }
      >
        <div className="slot-list">
          {current.slots.map((slot) => {
            const options = [...(byPos.get(slot.slotPos) ?? [])];
            if (
              slot.playerId != null &&
              !options.some((player) => player.id === slot.playerId)
            ) {
              const currentPlayer = players.find((p) => p.id === slot.playerId);
              if (currentPlayer) options.unshift(currentPlayer);
            }
            return (
              <div className="slot-card" key={slot.slotIndex}>
                <div className="slot-pos">{slot.slotPos}</div>
                <div className="slot-body">
                  <label htmlFor={`slot-${slot.slotIndex}`}>
                    Pick {slot.slotIndex + 1}
                  </label>
                  <select
                    id={`slot-${slot.slotIndex}`}
                    value={slot.playerId ?? ""}
                    disabled={pending}
                    onChange={(event) =>
                      onChangeSlot(slot.slotIndex, event.target.value)
                    }
                  >
                    <option value="">— empty —</option>
                    {options.map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name} ({player.club}) · {player.pts} pts · £
                        {player.price.toFixed(1)}m
                      </option>
                    ))}
                  </select>
                  <div className="slot-meta">
                    {slot.playerName
                      ? `${slot.club ?? ""} · ${slot.pts ?? 0} pts · £${(slot.price ?? 0).toFixed(1)}m`
                      : "No player selected"}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className={`status${error ? " error" : ""}`} aria-live="polite">
          {pending ? "Saving…" : error || message}
        </div>
      </EditUnlock>
    </div>
  );
}
