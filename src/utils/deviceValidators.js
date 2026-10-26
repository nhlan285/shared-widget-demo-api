const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validDeviceId = (value) => typeof value === 'string' && UUID.test(value);
const validOTP = (value) => typeof value === 'string' && /^\d{6}$/.test(value);
const validCredential = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const validatePush = (body) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).some((key) => key !== 'fcmToken')
    || typeof body.fcmToken !== 'string' || !body.fcmToken.length
    || body.fcmToken.length > 4096 || /\s/.test(body.fcmToken)) {
    return 'Only fcmToken is allowed: a non-empty token without whitespace (max 4096 characters)';
  }
  return null;
};

module.exports = { validDeviceId, validOTP, validCredential, validatePush };
