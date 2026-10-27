const { binding, optionalBinding } = require("../config/cloudflare");
const { sendSuccessResponse, sendErrorResponse, publicOrigin } = require("../utils/sendResponse");
const { parseMultipartForm } = require("../helpers/parseMultipartForm");
const model = require("../models/postcardModel");
const service = require("../services/postcardService");
const validation = require("../utils/postcardValidation");

const environment = () => ({ DB: binding("DB"), FILES: optionalBinding("FILES"),
  POSTCARD_ROOMS: optionalBinding("POSTCARD_ROOMS"), JWT_SECRET: optionalBinding("JWT_SECRET") });
const handle = (action) => async (req, res) => {
  try { return await action(req, res, environment()); }
  catch (error) {
    if (!error.statusCode) console.error("Postcard API error:", error.message);
    if (error.activePostcardId) return res.status(409).json({
      statusCode:409, error:"ACTIVE_CANVAS_EXISTS", code:"ACTIVE_CANVAS_EXISTS", message:error.message,
      data:{activePostcardId:error.activePostcardId},timestamp:new Date().toISOString()});
    return sendErrorResponse(res, error.statusCode || 500,
      error.statusCode ? "Postcard Request Failed" : "Internal Server Error",
      error.statusCode ? error.message : "Could not process postcard request");
  }
};

const create = handle(async (req, res, env) => {
  const pairId = await service.requirePair(env, req.userId);
  if (req.body.kind !== undefined && req.body.kind !== "shared_canvas") {
    throw validation.fail("Use the private Doodle endpoint for doodles");
  }
  const postcard = await service.callRoom(env, pairId, "create", {
    userId: req.userId, canvas: validation.canvas(req.body), kind:req.body.kind });
  return sendSuccessResponse(res, 201, "Postcard draft created", postcard);
});

const list = handle(async (req, res, env) => {
  const pairId = await service.requirePair(env, req.userId);
  const status = req.query.status || "sent";
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 20);
  if (!["draft", "sent"].includes(status) || !Number.isInteger(page) || page < 1 || page > 10000
    || !Number.isInteger(limit) || limit < 1 || limit > 50) throw validation.fail("Invalid status, page or limit");
  const postcards = await model.list(env.DB, pairId, status, limit, (page - 1) * limit);
  return sendSuccessResponse(res, 200, "Postcards retrieved", { postcards, page, limit });
});

const get = handle(async (req, res, env) => {
  const row = await service.requirePostcard(env, req.userId, req.params.id);
  const postcard = await service.callRoom(env, row.pair_id, "get", { userId: req.userId, postcardId: row.postcard_id });
  return sendSuccessResponse(res, 200, "Postcard retrieved", postcard);
});

const ticket = handle(async (req, res, env) => {
  const pairId = await service.requirePair(env, req.userId);
  service.room(env, pairId); // Fail early if the deployment omitted the binding.
  const result = service.createTicket(env, req.userId, pairId, req.user.exp);
  const url = new URL("/v1/postcards/realtime", publicOrigin(req));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", result.ticket);
  res.setHeader("Cache-Control", "no-store");
  return sendSuccessResponse(res, 201, "Realtime ticket created", { ...result, websocketUrl: url.toString() });
});

const roomAction = (action, message) => handle(async (req, res, env) => {
  const row = await service.requirePostcard(env, req.userId, req.params.id);
  const result = await service.callRoom(env, row.pair_id, action, {
    userId: req.userId, postcardId: row.postcard_id,
    revision: req.body?.revision, lockId: req.body?.lockId,
  });
  return sendSuccessResponse(res, 200, message, result);
});

const send = handle(async (req, res, env) => {
  const row = await service.requirePostcard(env, req.userId, req.params.id);
  if (row.sender_id !== req.userId) throw validation.fail("Only the postcard owner can send", 403);
  const closing = req.path.endsWith("/close");
  if (closing && row.kind !== "shared_canvas") throw validation.fail("Not a shared canvas",400);
  if (!closing && row.kind) throw validation.fail("Use the dedicated Doodle/close endpoint",400);
  if (row.status === "sent") return sendSuccessResponse(res, 200, "Postcard already sent", model.view(row));
  let lockId;
  let candidateKey;
  try {
    const { files, fields } = await parseMultipartForm(req);
    const title = typeof fields.title === "string" ? fields.title.trim() : "";
    if (closing && (!title || [...title].length > 80)) throw validation.fail("Canvas title must have 1-80 characters");
    lockId = fields.lockId;
    if (typeof lockId !== "string" || lockId.length > 64 || !/^\d+$/.test(fields.revision || "")) {
      throw validation.fail("lockId and integer revision are required");
    }
    const revision = Number(fields.revision);
    if (!Number.isSafeInteger(revision)) throw validation.fail("Invalid revision");
    if (!env.FILES) throw validation.fail("R2 image storage is not configured", 503);
    const contentType = validation.imageType(files.file, row.width, row.height);
    // Check the lock before uploading; finalize checks it again after the upload.
    const upload = await service.callRoom(env, row.pair_id, "validate-upload", {
      userId: req.userId, postcardId: row.postcard_id, revision, lockId,
    });
    if (upload.alreadySent) return sendSuccessResponse(res, 200, "Postcard already sent", upload.postcard);
    candidateKey = `postcards/${row.pair_id}/${row.postcard_id}/${crypto.randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`;
    await env.DB.prepare("INSERT INTO postcard_image_cleanup (image_key,pair_id,not_before) VALUES (?,?,?)")
      .bind(candidateKey, row.pair_id, Date.now() + 600000).run();
    await env.FILES.put(candidateKey, files.file.buffer, { httpMetadata: { contentType, cacheControl: "private, no-store" } });
    const postcard = await service.callRoom(env, row.pair_id, "finalize", {
      userId: req.userId, postcardId: row.postcard_id, revision, lockId,
      imageKey: candidateKey, contentType, title,
    });
    // A concurrent/retried send may already have committed another candidate.
    const saved = await model.get(env.DB, row.postcard_id);
    if (saved?.image_key !== candidateKey) await discardCandidate(env, candidateKey);
    return sendSuccessResponse(res, 200, "Postcard sent", postcard);
  } catch (error) {
    if (candidateKey) {
      // Never delete an image whose finalize succeeded but whose HTTP response was lost.
      const saved = await model.get(env.DB, row.postcard_id);
      if (saved?.status === "sent" && saved.image_key === candidateKey) {
        return sendSuccessResponse(res, 200, "Postcard sent", model.view(saved));
      }
      await discardCandidate(env, candidateKey);
    }
    if (lockId) {
      try { await service.callRoom(env, row.pair_id, "unlock", { userId: req.userId, postcardId: row.postcard_id, lockId }); }
      catch { /* A newer lock, a sent postcard or a disconnected pair must not be changed. */ }
    }
    if (error.message === "Invalid multipart form data") throw validation.fail(error.message);
    throw error;
  }
});

const discardCandidate = async (env, key) => {
  try {
    await env.FILES.delete(key);
    await env.DB.prepare("DELETE FROM postcard_image_cleanup WHERE image_key = ?").bind(key).run();
  } catch { /* The staging row remains queued for scheduled cleanup. */ }
};

const image = handle(async (req, res, env) => {
  const row = await service.requirePostcard(env, req.userId, req.params.id);
  if (row.status !== "sent") throw validation.fail("Postcard has not been sent", 404);
  if (!env.FILES) throw validation.fail("R2 image storage is not configured", 503);
  const object = await env.FILES.get(row.image_key);
  if (!object) throw validation.fail("Postcard image not found", 404);
  // Recheck after object retrieval in case the pair was disconnected during I/O.
  await service.requirePostcard(env, req.userId, req.params.id);
  res.setHeader("Content-Type", row.image_content_type);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="postcard-${row.postcard_id}.${row.image_content_type === "image/png" ? "png" : "jpg"}"`);
  return res.status(200).send(Buffer.from(await object.arrayBuffer()));
});

module.exports = { create, list, get, ticket, send, image,
  lock: roomAction("lock", "Canvas locked for sending"),
  unlock: roomAction("unlock", "Canvas unlocked"),
  discard: roomAction("discard", "Postcard draft discarded"),
};
