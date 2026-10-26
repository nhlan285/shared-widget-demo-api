-- Additive demo extension. Existing postcards/auth tables stay compatible.
CREATE TABLE creation_metadata (
  postcard_id TEXT PRIMARY KEY REFERENCES postcards(postcard_id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('doodle','shared_canvas')),
  title TEXT NOT NULL DEFAULT '',
  source TEXT CHECK (source IN ('camera','blank')),
  expires_at INTEGER,
  closed_at INTEGER,
  expiry_queued INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT,
  payload_hash TEXT
);
CREATE TABLE active_shared_canvases (
  pair_id TEXT PRIMARY KEY REFERENCES pairs(pair_id),
  postcard_id TEXT NOT NULL UNIQUE REFERENCES postcards(postcard_id) ON DELETE CASCADE
);
CREATE TABLE doodle_requests (
  pair_id TEXT NOT NULL REFERENCES pairs(pair_id),
  user_id TEXT NOT NULL REFERENCES users(user_id),
  request_key TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  postcard_id TEXT NOT NULL UNIQUE REFERENCES postcards(postcard_id) ON DELETE CASCADE,
  PRIMARY KEY (pair_id, user_id, request_key)
);
CREATE INDEX idx_creation_expiry ON creation_metadata(expires_at) WHERE kind='doodle';
CREATE TRIGGER creation_pair_archived AFTER UPDATE OF status ON pairs
WHEN OLD.status <> 'archived' AND NEW.status='archived'
BEGIN
  DELETE FROM active_shared_canvases WHERE pair_id=NEW.pair_id;
  DELETE FROM doodle_requests WHERE pair_id=NEW.pair_id;
END;
