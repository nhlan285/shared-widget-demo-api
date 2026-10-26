const { get, all } = require('../config/database');
const { db } = require('../config/cloudflare');

const getTrustedDevice = (userId, deviceId) => get(`SELECT * FROM user_devices
  WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`, [userId, deviceId]);

const getCurrentDevice = async (userId, sessionId) => {
  const row = await get(`SELECT d.*, s.session_id FROM user_sessions s
    JOIN user_devices d ON d.user_id = s.user_id AND d.device_id = s.device_id
    JOIN users u ON u.user_id = s.user_id
    WHERE s.user_id = ? AND s.session_id = ? AND s.expires_at > ?
    AND u.is_active = 1 AND d.revoked_at IS NULL`, [userId, sessionId, Date.now()]);
  if (!row) return null;
  return {
    deviceId: row.device_id,
    platform: row.platform,
    pushRegistered: Boolean(row.fcm_token && row.fcm_session_id === sessionId),
    verifiedAt: new Date(row.verified_at).toISOString(),
    lastLoginAt: new Date(row.last_login_at).toISOString(),
  };
};

const registerDevice = async (userId, sessionId, fcmToken) => {
  const database = db();
  const now = Date.now();
  const eligible = `EXISTS (SELECT 1 FROM user_sessions s JOIN users u ON u.user_id = s.user_id
    WHERE s.user_id = ? AND s.session_id = ? AND s.expires_at > ? AND u.is_active = 1)`;
  const results = await database.batch([
    database.prepare(`UPDATE user_devices SET fcm_token = NULL, fcm_session_id = NULL
      WHERE fcm_token = ? AND ${eligible}`).bind(fcmToken, userId, sessionId, now),
    database.prepare(`UPDATE user_devices SET fcm_token = ?, fcm_session_id = ?
      WHERE user_id = ? AND revoked_at IS NULL AND device_id =
        (SELECT device_id FROM user_sessions WHERE user_id = ? AND session_id = ?)
      AND ${eligible} RETURNING device_id`)
      .bind(fcmToken, sessionId, userId, userId, sessionId, userId, sessionId, now),
  ]);
  return results[1].results.length === 1;
};

const unregisterDevice = async (userId, sessionId) => {
  await get(`UPDATE user_devices SET fcm_token = NULL, fcm_session_id = NULL
    WHERE user_id = ? AND fcm_session_id = ? RETURNING device_id`, [userId, sessionId]);
};

const getDevicesByUserId = async (userId) => {
  const rows = await all(`SELECT d.device_id, d.fcm_token FROM user_devices d
    JOIN user_sessions s ON s.user_id = d.user_id AND s.device_id = d.device_id
      AND s.session_id = d.fcm_session_id
    JOIN users u ON u.user_id = d.user_id
    WHERE d.user_id = ? AND s.expires_at > ? AND d.revoked_at IS NULL
      AND d.fcm_token IS NOT NULL AND u.is_active = 1`, [userId, Date.now()]);
  return rows.map((row) => ({ deviceId: row.device_id, fcmToken: row.fcm_token }));
};

module.exports = { getTrustedDevice, getCurrentDevice, registerDevice,
  unregisterDevice, getDevicesByUserId };
