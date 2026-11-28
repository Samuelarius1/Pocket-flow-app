CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS user_sessions_expires_at_idx ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS releases (
  version TEXT PRIMARY KEY,
  notes TEXT NOT NULL,
  minimum_version TEXT NOT NULL DEFAULT '',
  mandatory BOOLEAN NOT NULL DEFAULT FALSE,
  published_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);

CREATE TABLE IF NOT EXISTS financial_records (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource TEXT NOT NULL CHECK (resource IN ('accounts', 'transactions', 'budgets', 'goals')),
  payload TEXT NOT NULL,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  PRIMARY KEY (user_id, resource, id)
);
CREATE INDEX IF NOT EXISTS financial_records_user_resource_updated_idx
  ON financial_records(user_id, resource, updated_at DESC);

CREATE TABLE IF NOT EXISTS financial_categories (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'transfer')),
  color TEXT NOT NULL DEFAULT '#0C8B5B',
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE UNIQUE INDEX IF NOT EXISTS financial_categories_user_name_kind_idx
  ON financial_categories(user_id, lower(name), kind) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS financial_categories_user_kind_idx
  ON financial_categories(user_id, kind, name);

CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  purchased BOOLEAN NOT NULL DEFAULT FALSE,
  version BIGINT NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text),
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS shopping_items_user_status_updated_idx
  ON shopping_items(user_id, purchased, updated_at DESC);

CREATE TABLE IF NOT EXISTS release_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  version TEXT NOT NULL REFERENCES releases(version) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action = 'published'),
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP::text)
);
CREATE INDEX IF NOT EXISTS release_audit_version_created_idx ON release_audit(version, created_at DESC);

INSERT INTO financial_categories(id, name, kind, color) VALUES
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
  ('system-transfer', 'Transfer', 'transfer', '#8D7CAB')
ON CONFLICT (id) DO NOTHING;
