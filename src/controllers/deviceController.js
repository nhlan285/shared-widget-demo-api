const deviceModel = require("../models/deviceModel");

const {
  validatePush,
} = require("../utils/deviceValidators");

const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../utils/sendResponse");

const registerDevice = async (req, res) => {
  try {
    if (!req.userId || !req.sessionId) {
      return sendErrorResponse(
        res,
        401,
        "Unauthorized",
        "User identity is required"
      );
    }

    const validationError =
      validatePush(req.body);

    if (validationError) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        validationError
      );
    }

    const updated = await deviceModel.registerDevice(
      req.userId,
      req.sessionId,
      req.body.fcmToken
    );

    if (!updated) {
      return sendErrorResponse(
        res,
        401,
        "SESSION_REVOKED",
        "Session is no longer valid"
      );
    }

    const device = await deviceModel.getCurrentDevice(
      req.userId,
      req.sessionId
    );

    if (!device) {
      return sendErrorResponse(
        res, 401, "SESSION_REVOKED", "Session is no longer valid"
      );
    }

    return sendSuccessResponse(
      res,
      200,
      "Device registered",
      device
    );
  } catch {
    // Không log request body hoặc FCM token.
    console.error("Device registration failed");

    return sendErrorResponse(
      res,
      500,
      "Internal Server Error",
      "Could not register device"
    );
  }
};
const getCurrentDevice = async (req, res) => {
  try {
    if (!req.userId || !req.sessionId) {
      return sendErrorResponse(
        res, 401, "Unauthorized", "User identity is required"
      );
    }

    const device = await deviceModel.getCurrentDevice(
      req.userId,
      req.sessionId
    );

    if (!device) {
      return sendErrorResponse(
        res, 401, "SESSION_REVOKED", "Session is no longer valid"
      );
    }

    return sendSuccessResponse(
      res, 200, "Current device fetched", device
    );
  } catch {
    console.error("Device lookup failed");
    return sendErrorResponse(
      res, 500, "Internal Server Error", "Could not fetch current device"
    );
  }
};

const unregisterDevice = async (req, res) => {
  try {
    if (!req.userId || !req.sessionId) {
      return sendErrorResponse(
        res,
        401,
        "Unauthorized",
        "User identity is required"
      );
    }

    if (req.body && (
      Array.isArray(req.body) || Object.keys(req.body).length > 0
    )) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "No request body is allowed"
      );
    }

    await deviceModel.unregisterDevice(
      req.userId,
      req.sessionId
    );

    return sendSuccessResponse(
      res,
      200,
      "Device unregistered",
      null
    );
  } catch {
    console.error("Device removal failed");

    return sendErrorResponse(
      res,
      500,
      "Internal Server Error",
      "Could not unregister device"
    );
  }
};

module.exports = {
  registerDevice,
  unregisterDevice,
  getCurrentDevice,
};
