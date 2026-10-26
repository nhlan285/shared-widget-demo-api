const { sendErrorResponse } = require('../utils/sendResponse');
const { verifyToken } = require('../utils/tokenUtils');
const { getActiveSession } = require('../models/sessionModel');

const authenticate = (optional) => async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header && optional) {
    req.user = null;
    req.userId = null;
    return next();
  }
  if (!header) return sendErrorResponse(res, 401, 'Access Denied', 'Access Token Required');
  let decoded;
  try {
    const match = /^Bearer ([^\s]+)$/i.exec(header);
    if (!match) throw new Error('Invalid authorization');
    decoded = verifyToken(match[1], 'access');
  } catch {
    return sendErrorResponse(res, 403, 'Invalid Token', 'Access Token Invalid Or Expired');
  }
  try {
    const session = await getActiveSession(decoded.userId, decoded.sessionId);
    if (!session) return sendErrorResponse(res, 401, 'SESSION_REVOKED', 'Session is no longer valid. Please sign in again.');
    req.user = decoded;
    req.userId = decoded.userId;
    req.sessionId = session.session_id;
    req.deviceId = session.device_id;
    return next();
  } catch {
    console.error('Session lookup failed');
    return sendErrorResponse(res, 500, 'Internal Server Error', 'Could not verify session');
  }
};

const authenticateToken = authenticate(false);
module.exports = { authenticateToken, authenticateUser: authenticateToken, optionalAuth: authenticate(true) };
