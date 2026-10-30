-- Finished games are exported (every scan + diplomacy) to the np-archive git
-- branch by a GitHub Action. Hourly history in D1 is only pruned after that.
ALTER TABLE games ADD COLUMN exported_at TEXT;
ALTER TABLE games ADD COLUMN archive_ref TEXT;
