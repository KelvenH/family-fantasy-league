import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamEditor } from "@/components/TeamEditor";
import { getTeamByName, listPlayers } from "@/lib/league";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ name: string }>;
};

export default async function TeamPage({ params }: Props) {
  const { name: raw } = await params;
  const name = decodeURIComponent(raw);
  const [team, players] = await Promise.all([
    getTeamByName(name),
    listPlayers(),
  ]);

  if (!team) notFound();

  return (
    <section className="panel">
      <Link className="back-link" href="/">
        ← Back to league
      </Link>
      <h1>{team.name}&apos;s team</h1>
      <p className="lede">
        Change any pick with the dropdown. Only players in that position are
        listed.
      </p>
      <TeamEditor team={team} players={players} />
    </section>
  );
}
