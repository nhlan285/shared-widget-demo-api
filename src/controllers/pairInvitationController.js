const invitationModel = require("../models/pairInvitationModel");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../utils/sendResponse");

const createInvitation = async (req, res) => {
  try {
    if (!req.userId) {
      return sendErrorResponse(
        res, 401, "Unauthorized",
        "User identity is required"
      );
    }

    const invitation = await invitationModel.createInvitation(
      req.userId
    );

    return sendSuccessResponse(
      res,
      201,
      "Invitation created",
      invitation
    );
  } catch (error) {
    const errorNames = {
      403: "Invitation Forbidden",
      409: "Invitation Conflict",
      503: "Invitation Unavailable",
    };

    if (errorNames[error.statusCode]) {
      return sendErrorResponse(
        res,
        error.statusCode,
        errorNames[error.statusCode],
        error.message
      );
    }

    console.error("Create Invitation Error:", error.message);

    return sendErrorResponse(
      res, 500, "Internal Server Error",
      "Could not create invitation"
    );
  }
};
// Chỉ chấp nhận đúng một trong hai: code hoặc linkToken.
const parseInvitationInput = (body) => {
  if (
    !body
    || typeof body !== "object"
    || Array.isArray(body)
  ) {
    throw Object.assign(
      new Error("Provide code or linkToken"),
      { statusCode: 400 }
    );
  }

  const keys = Object.keys(body);

  if (
    keys.length !== 1
    || !["code", "linkToken"].includes(keys[0])
  ) {
    throw Object.assign(
      new Error("Provide exactly one of code or linkToken"),
      { statusCode: 400 }
    );
  }

  if (keys[0] === "code") {
    if (
      typeof body.code !== "string"
      || !/^[A-Z0-9]{8}$/i.test(body.code.trim())
    ) {
      throw Object.assign(
        new Error("Code must contain 8 letters or numbers"),
        { statusCode: 400 }
      );
    }

    return { code: body.code.trim().toUpperCase() };
  }

  // Token hiện tại do randomBytes(32).toString("hex") tạo.
  if (
    typeof body.linkToken !== "string"
    || !/^[a-f0-9]{64}$/.test(body.linkToken)
  ) {
    throw Object.assign(
      new Error("Invalid link token"),
      { statusCode: 400 }
    );
  }

  return { linkToken: body.linkToken };
};

// Try/catch dùng chung cho ba controller mới.
const handleInvitation = (handler) => async (req, res) => {
  try {
    if (!req.userId) {
      return sendErrorResponse(
        res, 401, "Unauthorized",
        "User identity is required"
      );
    }

    return await handler(req, res);
  } catch (error) {
    const errorNames = {
      400: "Validation Failed",
      403: "Invitation Forbidden",
      404: "Invitation Not Found",
      409: "Invitation Conflict",
      410: "Invitation Expired",
    };

    if (errorNames[error.statusCode]) {
      return sendErrorResponse(
        res,
        error.statusCode,
        errorNames[error.statusCode],
        error.message
      );
    }

    console.error("Invitation API Error:", error.message);

    return sendErrorResponse(
      res, 500, "Internal Server Error",
      "Could not process invitation"
    );
  }
};

const previewInvitation = handleInvitation(
  async (req, res) => {
    const input = parseInvitationInput(req.body);

    const preview = await invitationModel.previewInvitation(
      input,
      req.userId
    );

    return sendSuccessResponse(
      res, 200, "Invitation preview retrieved", preview
    );
  }
);

const acceptInvitation = handleInvitation(
  async (req, res) => {
    const input = parseInvitationInput(req.body);

    const result = await invitationModel.acceptInvitation(
      input,
      req.userId
    );

    return sendSuccessResponse(
      res,
      result.created ? 201 : 200,
      "Pair connected",
      result.pair
    );
  }
);

const revokeInvitation = handleInvitation(
  async (req, res) => {
    const { invitationId } = req.params;

    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
        .test(invitationId)
    ) {
      return sendErrorResponse(
        res, 400, "Validation Failed",
        "Invalid invitation ID"
      );
    }

    await invitationModel.revokeInvitation(
      invitationId,
      req.userId
    );

    return sendSuccessResponse(
      res, 200, "Invitation revoked", null
    );
  }
);

module.exports = {
  createInvitation,
  previewInvitation,
  acceptInvitation,
  revokeInvitation,
};