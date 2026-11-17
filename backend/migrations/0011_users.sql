-- Simple username/password accounts for testers. Passwords are stored as
-- salted PBKDF2 hashes, never in plain text.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'tester',
  locked_game TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

-- Every game belongs to one user. Existing games are the admin's. A
-- tester's copy of a game is stored under "<game number>~<user id>".
ALTER TABLE games ADD COLUMN owner TEXT NOT NULL DEFAULT 'admin';

-- Player ratings and notes become per user.
CREATE TABLE player_notes_v2 (
  owner TEXT NOT NULL DEFAULT 'admin',
  alias_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  games_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner, alias_key)
);
INSERT INTO player_notes_v2 (owner, alias_key, alias, rating, note, games_json, created_at, updated_at)
  SELECT 'admin', alias_key, alias, rating, note, games_json, created_at, updated_at FROM player_notes;
DROP TABLE player_notes;
ALTER TABLE player_notes_v2 RENAME TO player_notes;

-- How testers use the site: one counter per user, day and event.
CREATE TABLE usage_events (
  owner TEXT NOT NULL,
  day TEXT NOT NULL,
  event TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, day, event)
);

CREATE TABLE feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT NOT NULL,
  page TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
