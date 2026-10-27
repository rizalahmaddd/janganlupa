CREATE TABLE link_shares (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER,
  PRIMARY KEY (link_id, email)
);
CREATE INDEX idx_link_shares_user ON link_shares(user_id, created_at DESC);
CREATE INDEX idx_link_shares_email ON link_shares(email);

ALTER TABLE collection_members ADD COLUMN seen_at INTEGER;
