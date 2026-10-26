-- Users (trước đây: Firestore collection users-base)
CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  profile_pic TEXT NOT NULL DEFAULT '',
  birthday TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  method_sign_up TEXT NOT NULL DEFAULT 'email',
  role TEXT NOT NULL DEFAULT 'user',
  gender INTEGER NOT NULL DEFAULT 0,
  fcm_token TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  scanned_data TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT,
  last_login TEXT
);

-- Scans (trước đây: subcollection users-base/{userId}/myScans)
CREATE TABLE scans (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  confidence REAL NOT NULL,
  time TEXT NOT NULL,
  image_url TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'skin',
  is_rescan INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);

CREATE INDEX scans_user_time ON scans(user_id, time);
