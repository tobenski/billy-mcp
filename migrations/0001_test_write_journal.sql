CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  target TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending', 'complete')),
  result TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_operation_per_target ON operations(target) WHERE state = 'pending';
