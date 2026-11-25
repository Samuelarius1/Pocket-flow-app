CREATE TABLE IF NOT EXISTS shopping_items (
  id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 999),
  purchased INTEGER NOT NULL DEFAULT 0 CHECK (purchased IN (0, 1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX IF NOT EXISTS shopping_items_user_status_updated_idx
  ON shopping_items(user_id, purchased, updated_at DESC);
