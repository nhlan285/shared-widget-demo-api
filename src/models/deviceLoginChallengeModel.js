const { db } = require('../config/cloudflare');
const { get, run } = require('../config/database');
const { OTP_EXPIRED_MINUTES, OTP_RESEND_COOLDOWN_SECONDS,
  DEVICE_OTP_WINDOW_MS, DEVICE_OTP_MAX_SENDS, OTP_MAX_ATTEMPTS } = require('../utils/constant');

const find = (challengeId) => get(
  'SELECT * FROM device_login_challenges WHERE challenge_id = ?', [challengeId]);

const create = async (userId, deviceId, otpHash) => {
  const database = db();
  const now = Date.now();
  const id = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`INSERT INTO device_login_challenges
      (challenge_id, user_id, device_id, expected_session_id, otp_hash,
       expires_at, last_sent_at, created_at)
      SELECT ?, u.user_id, ?, (SELECT session_id FROM user_sessions WHERE user_id = u.user_id),
        ?, ?, ?, ? FROM users u WHERE u.user_id = ? AND u.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM device_login_challenges
        WHERE user_id = u.user_id AND last_sent_at > ?)
      AND (SELECT COALESCE(SUM(send_count), 0) FROM device_login_challenges
        WHERE user_id = u.user_id AND last_sent_at > ?) < ?
      RETURNING *`).bind(id, deviceId, otpHash, now + OTP_EXPIRED_MINUTES * 60000,
    now, now, userId, now - OTP_RESEND_COOLDOWN_SECONDS * 1000,
    now - DEVICE_OTP_WINDOW_MS, DEVICE_OTP_MAX_SENDS),
    database.prepare(`UPDATE device_login_challenges SET invalidated_at = ?
      WHERE user_id = ? AND challenge_id <> ? AND consumed_at IS NULL AND invalidated_at IS NULL
      AND EXISTS (SELECT 1 FROM device_login_challenges WHERE challenge_id = ?)`)
      .bind(now, userId, id, id),
  ]);
  return results[0].results[0] || null;
};

const attempt = (challengeId) => get(`UPDATE device_login_challenges
  SET attempts = attempts + 1 WHERE challenge_id = ?
  AND consumed_at IS NULL AND invalidated_at IS NULL RETURNING *`, [challengeId]);

const resend = async (row, otpHash) => {
  const now = Date.now();
  return get(`UPDATE device_login_challenges SET otp_hash = ?, last_sent_at = ?,
    expires_at = ?, send_count = send_count + 1
    WHERE challenge_id = ? AND otp_hash = ? AND consumed_at IS NULL AND invalidated_at IS NULL
    AND attempts < ? AND last_sent_at <= ?
    AND (SELECT session_id FROM user_sessions WHERE user_id = device_login_challenges.user_id)
      IS expected_session_id
    AND EXISTS (SELECT 1 FROM users WHERE user_id = device_login_challenges.user_id AND is_active = 1)
    AND NOT EXISTS (SELECT 1 FROM device_login_challenges other
      WHERE other.user_id = device_login_challenges.user_id AND other.last_sent_at > ?)
    AND (SELECT COALESCE(SUM(other.send_count), 0) FROM device_login_challenges other
      WHERE other.user_id = device_login_challenges.user_id AND other.last_sent_at > ?) < ?
    RETURNING *`, [otpHash, now, now + OTP_EXPIRED_MINUTES * 60000,
    row.challenge_id, row.otp_hash, OTP_MAX_ATTEMPTS,
    now - OTP_RESEND_COOLDOWN_SECONDS * 1000, now - OTP_RESEND_COOLDOWN_SECONDS * 1000,
    now - DEVICE_OTP_WINDOW_MS, DEVICE_OTP_MAX_SENDS]);
};

const invalidate = (challengeId, otpHash) => run(`UPDATE device_login_challenges
  SET invalidated_at = ? WHERE challenge_id = ? AND otp_hash = ? AND consumed_at IS NULL`,
[Date.now(), challengeId, otpHash]);

module.exports = { find, create, attempt, resend, invalidate };
