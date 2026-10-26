-- One private canvas per sender in an active pair. Sent postcards are immutable.
CREATE TABLE postcards (
  postcard_id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES pairs(pair_id),
  sender_id TEXT NOT NULL REFERENCES users(user_id),
  recipient_id TEXT NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent')),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 4096),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 4096),
  background_color TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  drawing_json TEXT,
  image_key TEXT UNIQUE,
  image_content_type TEXT,
  created_at INTEGER NOT NULL,
  sent_at INTEGER,
  CHECK (sender_id <> recipient_id),
  CHECK ((status = 'draft' AND sent_at IS NULL AND image_key IS NULL)
    OR (status = 'sent' AND sent_at IS NOT NULL AND image_key IS NOT NULL))
);
CREATE UNIQUE INDEX uq_postcard_draft ON postcards(pair_id, sender_id) WHERE status = 'draft';
CREATE INDEX idx_postcard_inbox ON postcards(pair_id, status, created_at DESC, postcard_id);
CREATE INDEX idx_postcard_sent ON postcards(pair_id, status, sent_at DESC, postcard_id);

-- Also tracks in-flight uploads so a crashed upload can be collected later.
CREATE TABLE postcard_image_cleanup (
  image_key TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL,
  not_before INTEGER NOT NULL
);
CREATE TABLE postcard_room_cleanup (pair_id TEXT PRIMARY KEY);

-- Pair history is removed atomically with disconnect, even if realtime is down.
CREATE TRIGGER pair_archive_postcards
AFTER UPDATE OF status ON pairs
WHEN OLD.status <> 'archived' AND NEW.status = 'archived'
BEGIN
  INSERT OR IGNORE INTO postcard_room_cleanup (pair_id) VALUES (NEW.pair_id);
  INSERT INTO postcard_image_cleanup (image_key, pair_id, not_before)
    SELECT image_key, pair_id, 0 FROM postcards
    WHERE pair_id = NEW.pair_id AND image_key IS NOT NULL
    ON CONFLICT(image_key) DO UPDATE SET not_before = 0;
  DELETE FROM postcards WHERE pair_id = NEW.pair_id;
END;
