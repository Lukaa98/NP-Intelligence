-- The attacking fleet's route up to the viewer's star and where it is now,
-- so alerts can show "now at X -> A -> B -> your star".
ALTER TABLE threats ADD COLUMN route_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE threats ADD COLUMN origin_name TEXT;
ALTER TABLE threats ADD COLUMN origin_at INTEGER NOT NULL DEFAULT 0;

-- Alerts guessed from a fleet's heading turned out unreliable; drop them.
DELETE FROM threats WHERE kind = 'heading';
