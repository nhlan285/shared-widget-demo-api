-- Trusted device history is retained after logout; only one session per user.
CREATE TABLE user_devices (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'android' CHECK (platform = 'android'),
  verified_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL,
  revoked_at INTEGER,
  fcm_token TEXT UNIQUE,
  fcm_session_id TEXT,
  PRIMARY KEY (user_id, device_id),
  CHECK ((fcm_token IS NULL) = (fcm_session_id IS NULL))
);

CREATE TABLE user_sessions (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  device_id TEXT NOT NULL,
  refresh_token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at > created_at)
);

CREATE TABLE device_login_challenges (
  challenge_id TEXT NOT NULL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  expected_session_id TEXT,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  send_count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  consumed_at INTEGER,
  invalidated_at INTEGER
);
CREATE INDEX idx_device_challenges_user_sent
  ON device_login_challenges(user_id, last_sent_at DESC);
