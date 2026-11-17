-- Size of each stored scan, so per-game storage is a cheap sum instead of
-- reading every scan. Filled once for existing scans.
ALTER TABLE snapshots ADD COLUMN size_bytes INTEGER;
UPDATE snapshots SET size_bytes = LENGTH(CAST(data_json AS BLOB));
