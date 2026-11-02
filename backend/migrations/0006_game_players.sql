-- Who played in each game, so a new game can flag players you've met before.
CREATE TABLE game_players (
  game_number TEXT NOT NULL,
  alias_key TEXT NOT NULL,
  alias TEXT NOT NULL,
  uid INTEGER NOT NULL,
  PRIMARY KEY (game_number, alias_key)
);

CREATE INDEX game_players_alias_idx ON game_players(alias_key);
