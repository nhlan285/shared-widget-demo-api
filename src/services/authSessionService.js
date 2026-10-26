const { randomInt } = require('node:crypto');
const sessionModel = require('../models/sessionModel');
const deviceModel = require('../models/deviceModel');
const challenges = require('../models/deviceLoginChallengeModel');
const { getUserById } = require('../models/userModel');
const { attemptRegistrationOTP } = require('../models/otpModel');
const { sendDeviceLoginOTP } = require('../utils/emailUtils');
const { AuthError } = require('../utils/authError');
const { hashSecret, randomSecret, hashMatches, createTokens, verifyToken } = require('../utils/tokenUtils');
const { SESSION_LIFETIME_MS, OTP_MAX_ATTEMPTS, OTP_EXPIRED_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS, isDevelopment } = require('../utils/constant');

const fail = (status, code, message) => { throw new AuthError(status, code, message); };
const userData = (user) => ({ userId: user.userId, email: user.email,
  displayName: user.displayName, profilePic: user.profilePic });

const complete = async (user, deviceId, expectedSessionId, proof, credential) => {
  const deviceCredential = credential || randomSecret();
  const sessionId = crypto.randomUUID();
  const tokens = createTokens(user, sessionId);
  const ok = await sessionModel.transition({ userId: user.userId, deviceId,
    expectedSessionId, sessionId, proof,
    credentialHash: hashSecret('device', `${user.userId}:${deviceId}:${deviceCredential}`),
    refreshHash: hashSecret('refresh', tokens.refreshToken),
    expiresAt: Date.now() + SESSION_LIFETIME_MS });
  if (!ok) fail(409, 'LOGIN_STATE_CHANGED', 'Login state changed. Please sign in again.');
  return { isOTP: false, user: userData(user), tokens, deviceCredential };
};

const finishRegistration = async (user, deviceId, otp) => {
  const row = await attemptRegistrationOTP(user.userId);
  if (!row) fail(400, 'Invalid OTP', 'OTP not found. Please request a new one.');
  if (Date.parse(row.expires_at) <= Date.now()) fail(400, 'Invalid OTP', 'OTP has expired. Please request a new one.');
  if (row.attempts > OTP_MAX_ATTEMPTS) fail(400, 'Invalid OTP', 'Too many failed attempts. Please request a new one.');
  if (row.otp !== otp) fail(400, 'Invalid OTP', 'Invalid OTP. Please try again.');
  return complete(user, deviceId, null, { type: 'registration', otp, createdAt: row.created_at });
};

const deliver = async (user, row, otp) => {
  try {
    await sendDeviceLoginOTP(user.email, otp, user.displayName);
  } catch {
    await challenges.invalidate(row.challenge_id, row.otp_hash);
    fail(503, 'OTP_DELIVERY_FAILED', 'Could not send verification code. Please try again later.');
  }
  return { isOTP: true, challengeId: row.challenge_id,
    emailMasked: user.email.replace(/(.{3})(.*)(?=@)/, (_, head, rest) => head + '*'.repeat(rest.length)),
    expiresIn: OTP_EXPIRED_MINUTES * 60, resendAfter: OTP_RESEND_COOLDOWN_SECONDS,
    ...(isDevelopment() ? { otp } : {}) };
};

const login = async (user, deviceId, credential) => {
  const device = await deviceModel.getTrustedDevice(user.userId, deviceId);
  const current = await sessionModel.getSession(user.userId);
  if (device && credential && hashMatches(device.credential_hash,
    hashSecret('device', `${user.userId}:${deviceId}:${credential}`))) {
    return complete(user, deviceId, current?.session_id || null, { type: 'trusted' }, credential);
  }
  const otp = String(randomInt(0, 1000000)).padStart(6, '0');
  const row = await challenges.create(user.userId, deviceId,
    hashSecret('device-otp', `${user.userId}:${deviceId}:${otp}`));
  if (!row) fail(429, 'Too Many Requests', 'Please wait before requesting another device code.');
  return deliver(user, row, otp);
};

const checkChallenge = async (row) => {
  if (!row || row.consumed_at !== null || row.invalidated_at !== null) {
    fail(400, 'INVALID_CHALLENGE', 'Challenge is unavailable. Please sign in again.');
  }
  const current = await sessionModel.getSession(row.user_id);
  if ((current?.session_id || null) !== row.expected_session_id) {
    fail(409, 'LOGIN_STATE_CHANGED', 'Login state changed. Please sign in again.');
  }
  const user = await getUserById(row.user_id);
  if (!user.isActive) fail(403, 'Account Inactive', 'An active account is required');
  return user;
};

const verifyDeviceLogin = async (challengeId, otp) => {
  const row = await challenges.attempt(challengeId);
  const user = await checkChallenge(row);
  if (row.expires_at <= Date.now()) fail(400, 'Invalid OTP', 'OTP has expired. Please request a new one.');
  if (row.attempts > OTP_MAX_ATTEMPTS) fail(400, 'Invalid OTP', 'Too many failed attempts. Please sign in again.');
  const otpHash = hashSecret('device-otp', `${row.user_id}:${row.device_id}:${otp}`);
  if (!hashMatches(row.otp_hash, otpHash)) fail(400, 'Invalid OTP', 'Invalid OTP. Please try again.');
  return complete(user, row.device_id, row.expected_session_id,
    { type: 'challenge', challengeId, otpHash });
};

const resendDeviceOTP = async (challengeId) => {
  const previous = await challenges.find(challengeId);
  const user = await checkChallenge(previous);
  if (previous.attempts >= OTP_MAX_ATTEMPTS) fail(400, 'Invalid OTP', 'Too many failed attempts. Please sign in again.');
  let otp;
  let otpHash;
  do {
    otp = String(randomInt(0, 1000000)).padStart(6, '0');
    otpHash = hashSecret('device-otp', `${previous.user_id}:${previous.device_id}:${otp}`);
  } while (otpHash === previous.otp_hash);
  const row = await challenges.resend(previous, otpHash);
  if (!row) fail(429, 'Too Many Requests', 'Please wait before requesting another device code.');
  return deliver(user, row, otp);
};

const refresh = async (refreshToken) => {
  let decoded;
  try { decoded = verifyToken(refreshToken, 'refresh'); }
  catch { fail(401, 'Invalid Token', 'Invalid or expired refresh token'); }
  let user;
  try { user = await getUserById(decoded.userId); }
  catch (error) {
    if (error.message === 'User not found') fail(401, 'Invalid Token', 'User no longer exists');
    throw error;
  }
  if (!user.isActive) fail(401, 'Account Inactive', 'Account has been deactivated');
  const tokens = createTokens(user, decoded.sessionId);
  const ok = await sessionModel.rotateRefresh(user.userId, decoded.sessionId,
    hashSecret('refresh', refreshToken), hashSecret('refresh', tokens.refreshToken),
    Date.now() + SESSION_LIFETIME_MS);
  if (!ok) fail(401, 'SESSION_REVOKED', 'Session or refresh token is no longer valid');
  return tokens;
};

module.exports = { finishRegistration, login, verifyDeviceLogin, resendDeviceOTP, refresh };
