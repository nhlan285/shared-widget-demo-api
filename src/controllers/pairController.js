const pairModel = require("../models/pairModel");
const { binding, optionalBinding } = require("../config/cloudflare");
const { room } = require("../services/postcardService");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../utils/sendResponse");

const validDate = (value) => {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime())
    && date.toISOString().slice(0, 10) === value;
};

const handle = (handler) => async (req, res) => {
  try {
    if (!req.userId) {
      return sendErrorResponse(
        res, 401, "Unauthorized",
        "User identity is required"
      );
    }

    return await handler(req, res);
  } catch (error) {
    console.error("Pair API Error:", error.message);

    return sendErrorResponse(
      res, 500, "Internal Server Error",
      "Could not process pair request"
    );
  }
};

const createPairFromInvitation = handle (async (req, res)=> {
  
})
const getCurrentPair = handle(async (req, res) => {
  const pair = await pairModel.getCurrentPair(req.userId);

  return sendSuccessResponse(
    res,
    200,
    pair ? "Current pair retrieved" : "No active pair",
    pair
  );
});

const updateCurrentPair = handle(async (req, res) => {
  const body = req.body || {};

  if (
    !Object.prototype.hasOwnProperty.call(
      body, "anniversaryDate"
    )
    || Object.keys(body).some(
      (key) => key !== "anniversaryDate"
    )
    || !validDate(body.anniversaryDate)
  ) {
    return sendErrorResponse(
      res, 400, "Validation Failed",
      "Only anniversaryDate is allowed: YYYY-MM-DD or null"
    );
  }

  const pair = await pairModel.getCurrentPair(req.userId);

  if (!pair) {
    return sendErrorResponse(
      res, 404, "Pair Not Found",
      "You do not have an active pair"
    );
  }

  const updated = await pairModel.updateAnniversary(
    pair.pairId,
    req.userId,
    body.anniversaryDate
  );

  if (!updated) {
    return sendErrorResponse(
      res, 409, "Pair Changed",
      "The pair is no longer active"
    );
  }

  return sendSuccessResponse(
    res, 200, "Anniversary updated",
    {
      pairId: pair.pairId,
      anniversaryDate: body.anniversaryDate,
    }
  );
});

const disconnectCurrentPair = handle(async (req, res) => {
  const postcardEnv = { DB: binding("DB"), FILES: optionalBinding("FILES"),
    POSTCARD_ROOMS: optionalBinding("POSTCARD_ROOMS") };
  const pair = await pairModel.getCurrentPair(req.userId);

  if (!pair) {
    return sendErrorResponse(
      res, 404, "Pair Not Found",
      "You do not have an active pair"
    );
  }

  const disconnected = await pairModel.disconnectPair(
    pair.pairId,
    req.userId
  );

  if (!disconnected) {
    return sendErrorResponse(
      res, 409, "Pair Changed",
      "The pair is no longer active"
    );
  }

  // The D1 trigger has already removed history and queued images for deletion.
  if (postcardEnv.POSTCARD_ROOMS) {
    try {
      await room(postcardEnv, pair.pairId).fetch(new Request("https://postcard.internal/disconnect", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ pairId: pair.pairId }),
      }));
    } catch (error) { console.error("Postcard disconnect cleanup will retry:", error.message); }
  }

  return sendSuccessResponse(
    res, 200, "Pair disconnected", null
  );
});

module.exports = {
  getCurrentPair,
  updateCurrentPair,
  disconnectCurrentPair,
};
