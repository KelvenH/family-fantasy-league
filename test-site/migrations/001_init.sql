CREATE TABLE IF NOT EXISTS players (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  pos TEXT NOT NULL,
  club TEXT NOT NULL,
  price NUMERIC(5, 1) NOT NULL DEFAULT 0,
  pts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS teams (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS team_slots (
  id SERIAL PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL,
  slot_pos TEXT NOT NULL,
  player_id INTEGER REFERENCES players (id),
  UNIQUE (team_id, slot_index)
);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_slots_team ON team_slots (team_id);
CREATE INDEX IF NOT EXISTS idx_players_pos ON players (pos);
