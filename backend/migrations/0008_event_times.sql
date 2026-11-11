-- Real time of the scan an event was detected in, so activity can be shown
-- by time of day (and a player's likely timezone estimated).
ALTER TABLE relation_events ADD COLUMN at TEXT;
