CREATE TABLE IF NOT EXISTS edit_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS pin_lockout (
  id TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_edit_sessions_expires ON edit_sessions (expires_at);

INSERT INTO pin_lockout (id, failures, window_start, locked_until)
VALUES ('global', 0, now(), NULL)
ON CONFLICT (id) DO NOTHING;
