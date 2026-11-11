-- Rows written to D1 per UTC day, counted by the Worker itself, so it can
-- pause optional work before the free plan's 100k/day limit.
CREATE TABLE usage_daily (
  day TEXT PRIMARY KEY,
  rows_written INTEGER NOT NULL DEFAULT 0
);
