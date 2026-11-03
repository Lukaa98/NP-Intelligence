-- Enemy fleets heading at the viewer's stars, one row per fleet + target.
-- Open while the fleet is on its way; closed with an outcome once it lands
-- ("fell" / "held") or disappears from view ("gone").
CREATE TABLE threats (
  game_number TEXT NOT NULL,
  key TEXT NOT NULL,
  kind TEXT NOT NULL,
  fleet_uid INTEGER NOT NULL,
  owner_uid INTEGER NOT NULL,
  owner_alias TEXT NOT NULL,
  ships INTEGER NOT NULL,
  target_uid INTEGER NOT NULL,
  target_name TEXT NOT NULL,
  eta_tick INTEGER NOT NULL,
  eta_minutes INTEGER NOT NULL,
  defenders INTEGER NOT NULL,
  verdict TEXT NOT NULL,
  first_tick INTEGER NOT NULL,
  last_tick INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  outcome TEXT,
  snapshot_id TEXT,
  notified_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_number, key)
);

CREATE INDEX threats_open_idx ON threats(status, game_number);

-- Small key/value settings (e.g. the ntfy topic for phone alerts).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
