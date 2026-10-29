-- Soft-delete: archived games stop being scanned but keep their history.
ALTER TABLE games ADD COLUMN archived_at TEXT;
-- Set when a scan reports the game is over; the scheduler stops polling it.
ALTER TABLE games ADD COLUMN finished_at TEXT;

-- Pinned snapshots are the "captures" shown as viewable maps.
ALTER TABLE snapshots ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE snapshots ADD COLUMN label TEXT;

CREATE INDEX snapshots_game_pinned_idx
  ON snapshots(game_number, pinned, captured_at);

-- Personal ratings and notes on players, keyed by lowercased alias so they
-- carry across games.
CREATE TABLE player_notes (
  alias_key TEXT PRIMARY KEY,
  alias TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  games_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
