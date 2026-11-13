CREATE TABLE IF NOT EXISTS trusted_devices (
  token_hash TEXT PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_trusted_devices_expires ON trusted_devices (expires_at);
