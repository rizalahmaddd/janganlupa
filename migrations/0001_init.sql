CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE login_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  redirect TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX idx_login_tokens_email ON login_tokens(email, created_at);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  public_slug TEXT UNIQUE,
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_collections_user ON collections(user_id);

CREATE TABLE collection_members (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'editor')),
  invited_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (collection_id, email)
);
CREATE INDEX idx_members_user ON collection_members(user_id);
CREATE INDEX idx_members_email ON collection_members(email);

CREATE TABLE links (
  rid INTEGER PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_id TEXT REFERENCES collections(id) ON DELETE SET NULL,
  url TEXT NOT NULL,
  url_norm TEXT NOT NULL,
  domain TEXT NOT NULL,
  title TEXT,
  custom_title INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  note TEXT,
  image_url TEXT,
  custom_image INTEGER NOT NULL DEFAULT 0,
  favicon_url TEXT,
  site_name TEXT,
  content_type TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  http_status INTEGER,
  fetch_error TEXT,
  fetch_attempts INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER,
  pinned INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  archived_at INTEGER,
  deleted_at INTEGER,
  remind_at INTEGER,
  reminded_at INTEGER,
  open_count INTEGER NOT NULL DEFAULT 0,
  last_opened_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_links_user_norm ON links(user_id, url_norm) WHERE deleted_at IS NULL;
CREATE INDEX idx_links_user_created ON links(user_id, created_at DESC);
CREATE INDEX idx_links_collection ON links(collection_id, created_at DESC);
CREATE INDEX idx_links_domain ON links(user_id, domain);
CREATE INDEX idx_links_status ON links(status, fetch_attempts);
CREATE INDEX idx_links_remind ON links(remind_at) WHERE remind_at IS NOT NULL AND reminded_at IS NULL;
CREATE INDEX idx_links_deleted ON links(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, name)
);

CREATE TABLE link_tags (
  link_id TEXT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (link_id, tag_id)
);
CREATE INDEX idx_link_tags_tag ON link_tags(tag_id);

CREATE VIRTUAL TABLE links_fts USING fts5(
  title,
  description,
  note,
  url,
  tags,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
