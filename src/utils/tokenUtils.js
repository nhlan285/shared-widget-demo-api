const jwt = require('jsonwebtoken');
const { createHmac, randomBytes, timingSafeEqual } = require('node:crypto');
const { getJwtSecret, ACCESS_TOKEN_EXPIRED, REFRESH_TOKEN_EXPIRED } = require('./constant');

// Domain separation: credentials, OTPs and refresh tokens cannot share hashes.
const hashSecret = (purpose, value) => createHmac('sha256', getJwtSecret())
  .update(`${purpose}:${value}`).digest('hex');
const randomSecret = () => randomBytes(32).toString('hex');
const hashMatches = (expected, actual) => {
  if (typeof expected !== 'string' || typeof actual !== 'string'
    || expected.length !== actual.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
};
const createTokens = (user, sessionId) => {
  const payload = { userId: user.userId, email: user.email, sessionId };
  const accessToken = jwt.sign({ ...payload, tokenUse: 'access' }, getJwtSecret(), {
    algorithm: 'HS256', expiresIn: ACCESS_TOKEN_EXPIRED, jwtid: crypto.randomUUID(),
  });
  const refreshToken = jwt.sign({ ...payload, tokenUse: 'refresh' }, getJwtSecret(), {
    algorithm: 'HS256', expiresIn: REFRESH_TOKEN_EXPIRED, jwtid: crypto.randomUUID(),
  });
  return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_EXPIRED };
};
const verifyToken = (token, use) => {
  const decoded = jwt.verify(token, getJwtSecret(), { algorithms: ['HS256'] });
  if (!decoded || typeof decoded !== 'object' || decoded.tokenUse !== use
    || typeof decoded.userId !== 'string' || !decoded.userId
    || typeof decoded.sessionId !== 'string' || !decoded.sessionId) {
    throw new jwt.JsonWebTokenError(`Expected ${use} token with session identity`);
  }
  return decoded;
};

module.exports = { hashSecret, randomSecret, hashMatches, createTokens, verifyToken };
