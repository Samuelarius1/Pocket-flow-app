CREATE TABLE IF NOT EXISTS financial_categories (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  color TEXT NOT NULL DEFAULT '#0C8B5B',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_categories_user_name_kind_idx
  ON financial_categories(user_id, lower(name), kind) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_categories_user_kind_idx
  ON financial_categories(user_id, kind, name);
INSERT OR IGNORE INTO financial_categories(id, name, kind, color) VALUES
  ('system-food', 'Food & drink', 'expense', '#2F9B6B'),
  ('system-groceries', 'Groceries', 'expense', '#78A96B'),
  ('system-housing', 'Housing', 'expense', '#D99B49'),
  ('system-transport', 'Transport', 'expense', '#5489A8'),
  ('system-health', 'Health', 'expense', '#BE7772'),
  ('system-utilities', 'Utilities', 'expense', '#8D7CAB'),
  ('system-shopping', 'Shopping', 'expense', '#C47D9B'),
  ('system-other-expense', 'Other', 'expense', '#839088'),
  ('system-salary', 'Salary', 'income', '#2F9B6B'),
  ('system-freelance', 'Freelance', 'income', '#5489A8'),
  ('system-other-income', 'Other income', 'income', '#839088'),
  ('system-transfer', 'Transfer', 'transfer', '#8D7CAB');
CREATE TABLE IF NOT EXISTS release_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version TEXT NOT NULL REFERENCES releases(version) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action = 'published'),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS release_audit_version_created_idx ON release_audit(version, created_at DESC);
