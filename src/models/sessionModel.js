const { db } = require('../config/cloudflare');
const { get } = require('../config/database');
const { OTP_MAX_ATTEMPTS } = require('../utils/constant');

const getSession = (userId) => get('SELECT * FROM user_sessions WHERE user_id = ?', [userId]);
const getActiveSession = (userId, sessionId) => get(`
  SELECT s.* FROM user_sessions s JOIN users u ON u.user_id = s.user_id
  WHERE s.user_id = ? AND s.session_id = ? AND s.expires_at > ? AND u.is_active = 1
`, [userId, sessionId, Date.now()]);

// The first conditional write authorizes the entire transition. Later statements
// are gated by its freshly generated session ID, all inside one D1 transaction.
const transition = async ({ userId, deviceId, sessionId, expectedSessionId,
  refreshHash, credentialHash, expiresAt, proof }) => {
  const database = db();
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  let condition;
  let proofParams;
  if (proof.type === 'registration') {
    condition = `u.is_active = 0 AND EXISTS (
      SELECT 1 FROM otp_codes o WHERE o.user_id = u.user_id AND o.type = 'verify_email'
      AND o.otp = ? AND o.created_at = ? AND o.expires_at > ? AND o.attempts <= ?)`;
    proofParams = [proof.otp, proof.createdAt, stamp, OTP_MAX_ATTEMPTS];
  } else if (proof.type === 'challenge') {
    condition = `u.is_active = 1 AND EXISTS (
      SELECT 1 FROM device_login_challenges c WHERE c.challenge_id = ?
      AND c.user_id = u.user_id AND c.device_id = ? AND c.otp_hash = ?
      AND c.expected_session_id IS ? AND c.expires_at > ? AND c.attempts <= ?
      AND c.consumed_at IS NULL AND c.invalidated_at IS NULL)`;
    proofParams = [proof.challengeId, deviceId, proof.otpHash, expectedSessionId, now, OTP_MAX_ATTEMPTS];
  } else {
    condition = `u.is_active = 1 AND EXISTS (
      SELECT 1 FROM user_devices d WHERE d.user_id = u.user_id AND d.device_id = ?
      AND d.credential_hash = ? AND d.revoked_at IS NULL)`;
    proofParams = [deviceId, credentialHash];
  }
  const statement = (sql, params) => database.prepare(sql).bind(...params);
  const gate = `EXISTS (SELECT 1 FROM user_sessions s WHERE s.user_id = ? AND s.session_id = ?)`;
  const batch = [
    statement(`INSERT INTO user_sessions
      (user_id, session_id, device_id, refresh_token_hash, created_at, expires_at)
      SELECT u.user_id, ?, ?, ?, ?, ? FROM users u
      WHERE u.user_id = ? AND ${condition}
      AND (SELECT session_id FROM user_sessions WHERE user_id = u.user_id) IS ?
      ON CONFLICT(user_id) DO UPDATE SET session_id = excluded.session_id,
        device_id = excluded.device_id, refresh_token_hash = excluded.refresh_token_hash,
        created_at = excluded.created_at, expires_at = excluded.expires_at
      RETURNING session_id`,
    [sessionId, deviceId, refreshHash, now, expiresAt, userId, ...proofParams, expectedSessionId]),
    statement(`UPDATE users SET is_active = 1, last_login = ?, updated_at = ?
      WHERE user_id = ? AND ${gate}`, [stamp, stamp, userId, userId, sessionId]),
    statement(`UPDATE user_devices SET fcm_token = NULL, fcm_session_id = NULL
      WHERE (user_id = ? OR device_id = ?) AND ${gate}`, [userId, deviceId, userId, sessionId]),
    statement(`INSERT INTO user_devices
      (user_id, device_id, credential_hash, verified_at, last_login_at)
      SELECT ?, ?, ?, ?, ? WHERE ${gate}
      ON CONFLICT(user_id, device_id) DO UPDATE SET
        credential_hash = excluded.credential_hash, last_login_at = excluded.last_login_at,
        revoked_at = NULL`, [userId, deviceId, credentialHash, now, now, userId, sessionId]),
  ];
  if (proof.type === 'registration') {
    batch.push(statement(`DELETE FROM otp_codes WHERE user_id = ? AND type = 'verify_email'
      AND ${gate}`, [userId, userId, sessionId]));
  }
  if (proof.type === 'challenge') {
    batch.push(statement(`UPDATE device_login_challenges SET consumed_at = ?
      WHERE challenge_id = ? AND ${gate}`, [now, proof.challengeId, userId, sessionId]));
  }
  batch.push(statement(`UPDATE device_login_challenges SET invalidated_at = ?
    WHERE user_id = ? AND consumed_at IS NULL AND invalidated_at IS NULL AND ${gate}`,
  [now, userId, userId, sessionId]));
  const results = await database.batch(batch);
  return results[0].results.length === 1;
};

const rotateRefresh = async (userId, sessionId, oldHash, newHash, expiresAt) => {
  const row = await get(`UPDATE user_sessions SET refresh_token_hash = ?, expires_at = ?
    WHERE user_id = ? AND session_id = ? AND refresh_token_hash = ? AND expires_at > ?
    AND EXISTS (SELECT 1 FROM users WHERE user_id = ? AND is_active = 1)
    RETURNING session_id`, [newHash, expiresAt, userId, sessionId, oldHash, Date.now(), userId]);
  return Boolean(row);
};

const logout = async (userId, sessionId) => {
  const database = db();
  await database.batch([
    database.prepare(`UPDATE user_devices SET fcm_token = NULL, fcm_session_id = NULL
      WHERE user_id = ? AND fcm_session_id = ?`).bind(userId, sessionId),
    database.prepare('DELETE FROM user_sessions WHERE user_id = ? AND session_id = ?')
      .bind(userId, sessionId),
  ]);
};

module.exports = { getSession, getActiveSession, transition, rotateRefresh, logout };
