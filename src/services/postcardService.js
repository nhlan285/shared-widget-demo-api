const jwt = require("jsonwebtoken");
const model = require("../models/postcardModel");
const { fail } = require("../utils/postcardValidation");

const requirePair = async (env, userId) => {
  if (typeof userId !== "string" || !userId) throw fail("User identity is required", 401);
  const pair = await model.currentPair(env.DB, userId);
  if (!pair) throw fail("An active pair is required", 403);
  return pair.pair_id;
};

const requirePostcard = async (env, userId, id) => {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw fail("Invalid postcardId");
  const pairId = await requirePair(env, userId);
  const row = await model.get(env.DB, id);
  if (!row || row.pair_id !== pairId || ![row.sender_id, row.recipient_id].includes(userId)) {
    throw fail("Postcard not found", 404);
  }
  return row;
};

const room = (env, pairId) => {
  if (!env.POSTCARD_ROOMS) throw fail("Realtime binding is not configured", 503);
  return env.POSTCARD_ROOMS.get(env.POSTCARD_ROOMS.idFromName(pairId));
};

const callRoom = async (env, pairId, action, data) => {
  const response = await room(env, pairId).fetch(new Request(`https://postcard.internal/${action}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...data, pairId }),
  }));
  const result = await response.json();
  if (!response.ok) throw fail(result.message || "Postcard request failed", response.status);
  return result;
};

// Use a separate signing key purpose: a websocket ticket cannot become a REST JWT.
const ticketKey = (secret) => `postcard-realtime-v1:${secret}`;
const createTicket = (env, userId, pairId, accessExpiresAt) => {
  if (!env.JWT_SECRET) throw fail("JWT secret is not configured", 503);
  const liveUntil = Math.min(Number(accessExpiresAt) * 1000 || 0, Date.now() + 3600000);
  if (liveUntil <= Date.now()) throw fail("Access token has expired", 401);
  const ticket = jwt.sign({ pairId, liveUntil }, ticketKey(env.JWT_SECRET), {
    algorithm: "HS256", subject: userId, audience: "postcard-realtime", issuer: "shared-widget",
    jwtid: crypto.randomUUID(), expiresIn: 60,
  });
  return { ticket, expiresIn: 60, liveUntil: new Date(liveUntil).toISOString() };
};

const verifyTicket = (env, ticket) => {
  try {
    const payload = jwt.verify(ticket, ticketKey(env.JWT_SECRET), {
      algorithms: ["HS256"], audience: "postcard-realtime", issuer: "shared-widget",
    });
    if (!payload.sub || !payload.jti || !payload.pairId || !Number.isFinite(payload.liveUntil)
      || payload.liveUntil <= Date.now()) throw new Error("Invalid ticket claims");
    return payload;
  } catch { throw fail("Invalid or expired websocket ticket", 401); }
};

module.exports = { requirePair, requirePostcard, room, callRoom, createTicket, verifyTicket };
