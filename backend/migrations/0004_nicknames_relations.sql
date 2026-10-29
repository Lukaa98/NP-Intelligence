-- Your own label for a game ("64p blob, RocketCharger"), kept separate from
-- the NP name that every scan overwrites.
ALTER TABLE games ADD COLUMN nickname TEXT;
ALTER TABLE games ADD COLUMN player_count INTEGER;
ALTER TABLE games ADD COLUMN my_alias TEXT;

-- Relationship extraction progress: the last tick processed and a compact
-- state (star owners, tech levels) to diff the next snapshot against.
ALTER TABLE games ADD COLUMN relation_tick INTEGER;
ALTER TABLE games ADD COLUMN relation_snapshots INTEGER NOT NULL DEFAULT 0;
ALTER TABLE games ADD COLUMN relation_state TEXT;

-- Aggregated pairwise evidence per game. Continuous observations (guest
-- fleets, fleets en route, border contact, confirmed alliance) count
-- snapshots; discrete events (captures, tech trades) count occurrences.
-- Directional kinds use a = actor, b = target; symmetric kinds store a < b.
CREATE TABLE relations (
  game_number TEXT NOT NULL,
  kind TEXT NOT NULL,
  a_uid INTEGER NOT NULL,
  b_uid INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  weight REAL NOT NULL DEFAULT 0,
  ships INTEGER NOT NULL DEFAULT 0,
  first_tick INTEGER NOT NULL,
  last_tick INTEGER NOT NULL,
  samples_json TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (game_number, kind, a_uid, b_uid)
);

-- Timeline of discrete events (captures, suspected tech trades).
CREATE TABLE relation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_number TEXT NOT NULL,
  tick INTEGER NOT NULL,
  kind TEXT NOT NULL,
  a_uid INTEGER NOT NULL,
  b_uid INTEGER NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  detail TEXT NOT NULL DEFAULT ''
);

CREATE INDEX relation_events_game_tick_idx ON relation_events(game_number, tick DESC);
