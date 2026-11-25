CREATE TABLE IF NOT EXISTS financial_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('accounts', 'transactions', 'budgets', 'goals')),
  payload TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, resource, id)
);
CREATE INDEX IF NOT EXISTS financial_records_user_resource_updated_idx
  ON financial_records(user_id, resource, updated_at DESC);
