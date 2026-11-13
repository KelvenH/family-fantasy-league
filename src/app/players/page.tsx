import Link from "next/link";
import { PlayersAdmin } from "@/components/PlayersAdmin";
import { formatEditDate } from "@/lib/format";
import { getMeta, listPlayers } from "@/lib/league";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const [players, meta] = await Promise.all([listPlayers(), getMeta()]);

  return (
    <section className="panel">
      <Link className="back-link" href="/">
        ← Back to league
      </Link>
      <h1>Players</h1>
      <p className="meta">
        Last edit to points: {formatEditDate(meta.last_points_edit)}
      </p>
      <PlayersAdmin players={players} lastRefresh={meta.last_scores_refresh} />
    </section>
  );
}
