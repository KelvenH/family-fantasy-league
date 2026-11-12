import Link from "next/link";
import { PlayersAdmin } from "@/components/PlayersAdmin";
import { listPlayers } from "@/lib/league";

export const dynamic = "force-dynamic";

export default async function PlayersPage() {
  const players = await listPlayers();

  return (
    <section className="panel">
      <Link className="back-link" href="/">
        ← Back to league
      </Link>
      <h1>Players</h1>
      <PlayersAdmin players={players} />
    </section>
  );
}
