# Family Fantasy Football League

Simple browser app for viewing and editing the family fantasy league (league table, team XIs, player points). Built for Grandad on Windows in a normal browser — large text, no Excel.

## Run locally

```bash
cd fantasy-league
npm install
env -u DATABASE_URL npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Without `DATABASE_URL`, the app uses in-memory PGlite and seeds from `data/*.json` on first boot.

## Scripts

- `npm run dev` — local Next.js server
- `npm run build` — production build + migrate (migrate no-ops without `DATABASE_URL`)
- `npm start` — serve the production build

## Data

Seed files live in `data/`:

- `players.json` — selected catalogue (name, pos, club, price, pts)
- `teams.json` — managers and XI picks
- `league.json` — export snapshot (totals recomputed live from player pts)
- `meta.json` — export metadata

Edits persist in Postgres when published with Cursor (`cursor-app.json` requests a database). Locally they live in PGlite for the process lifetime.

## Pages

- `/` — league table sorted by points; tap a manager
- `/team/[name]` — view XI; change picks via position-filtered dropdowns
- `/players` — edit catalogue points; team totals update from these
