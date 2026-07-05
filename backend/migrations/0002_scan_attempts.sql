CREATE TABLE scan_attempts (
  id TEXT PRIMARY KEY,
  game_number TEXT NOT NULL,
  source TEXT NOT NULL,
  attempted_at TEXT NOT NULL,
  success INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX scan_attempts_game_time_idx
  ON scan_attempts(game_number, attempted_at DESC);
