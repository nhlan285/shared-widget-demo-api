-- OTP gửi qua email (trước đây: Firestore collection otp_codes)
-- Mỗi user chỉ giữ 1 mã cho mỗi loại; tạo mã mới thì ghi đè mã cũ.
CREATE TABLE otp_codes (
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  otp TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, type)
);
