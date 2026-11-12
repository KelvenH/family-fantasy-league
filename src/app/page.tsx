import Link from "next/link";
import { getMeta, listStandings } from "@/lib/league";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [standings, meta] = await Promise.all([listStandings(), getMeta()]);
  const waiting = meta.status === "waiting_for_data" || standings.length === 0;

  return (
    <section className="panel">
      <h1>League table</h1>
      <p className="lede">
        Tap a manager name to see their team and change picks. Totals come from
        each player&apos;s points.
      </p>

      {waiting ? (
        <div className="waiting">
          Waiting for league data… Place the export JSON files in{" "}
          <code>src/seed-data/</code>, then reload.
        </div>
      ) : null}

      {meta.exported_at ? (
        <p className="meta">Seeded from export {meta.exported_at}</p>
      ) : null}
      {meta.catalogue_note ? (
        <p className="meta">{meta.catalogue_note}</p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Manager</th>
              <th scope="col">Points</th>
              <th scope="col">£m</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((row) => (
              <tr key={row.id}>
                <td className="rank">{row.rank}</td>
                <td>
                  <Link
                    className="manager-link"
                    href={`/team/${encodeURIComponent(row.name)}`}
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="num">{row.totalPts}</td>
                <td className="num">{row.totalPrice.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
