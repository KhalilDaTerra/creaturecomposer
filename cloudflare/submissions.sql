CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  image_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  seed TEXT NOT NULL,
  category TEXT NOT NULL,
  pool_mode TEXT,
  creature_number TEXT,
  set_label TEXT,
  submitted_at INTEGER NOT NULL,
  data_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_submissions_submitted_at
ON submissions (submitted_at DESC);
