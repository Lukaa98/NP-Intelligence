CREATE TABLE games (
  game_number TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  player_uid INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1,
  key_status TEXT NOT NULL DEFAULT 'valid',
  key_status_message TEXT NOT NULL DEFAULT '',
  last_tick INTEGER,
  last_sync_at TEXT,
  last_error_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE snapshots (
  id TEXT PRIMARY KEY,
  game_number TEXT NOT NULL,
  tick INTEGER NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  production_counter INTEGER NOT NULL DEFAULT 0,
  production_rate INTEGER NOT NULL DEFAULT 0,
  player_uid INTEGER NOT NULL DEFAULT 0,
  game_name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  FOREIGN KEY (game_number) REFERENCES games(game_number) ON DELETE CASCADE
);

CREATE INDEX snapshots_game_tick_idx
  ON snapshots(game_number, tick, captured_at);
