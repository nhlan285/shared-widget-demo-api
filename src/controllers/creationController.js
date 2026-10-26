const { binding, optionalBinding } = require("../config/cloudflare");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../utils/sendResponse");
const { parseMultipartForm } = require("../helpers/parseMultipartForm");
const model = require("../models/creationModel");
const postcard = require("../models/postcardModel");
const service = require("../services/postcardService");
const { fail, imageType } = require("../utils/postcardValidation");
const env = () => ({
  DB: binding("DB"),
  FILES: optionalBinding("FILES"),
  POSTCARD_ROOMS: optionalBinding("POSTCARD_ROOMS"),
  JWT_SECRET: optionalBinding("JWT_SECRET"),
});
const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res, env());
  } catch (error) {
    if (!error.statusCode) console.error("Creation API failed:", error.message);
    return sendErrorResponse(
      res,
      error.statusCode || 500,
      "Creation Request Failed",
      error.statusCode ? error.message : "Could not process creation request",
    );
  }
};
const capabilities = handle(async (req, res, e) => {
  await service.requirePair(e, req.userId);
  res.setHeader("Cache-Control", "no-store");
  return sendSuccessResponse(res, 200, "Creation capabilities", {
    contractVersion: 2,
    privateDoodles: Boolean(e.FILES && e.POSTCARD_ROOMS),
    singleActiveCanvas: Boolean(e.POSTCARD_ROOMS),
    canvasArchive: Boolean(e.FILES && e.POSTCARD_ROOMS),
  });
});
const active = handle(async (req, res, e) => {
  const pairId = await service.requirePair(e, req.userId),
    row = await model.activeId(e.DB, pairId);
  const item = row
    ? await service.callRoom(e, pairId, "get", {
        userId: req.userId,
        postcardId: row.postcard_id,
      })
    : null;
  return sendSuccessResponse(res, 200, "Active shared canvas", item);
});
function filters(query) {
  const status = query.status || "sent",
    page = Number(query.page || 1),
    limit = Number(query.limit || 20);
  if (
    !["draft", "sent", "saved"].includes(status) ||
    !Number.isInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw fail("Invalid status, page or limit");
  const kind = query.kind;
  if (kind && !["doodle", "shared_canvas"].includes(kind))
    throw fail("Invalid artwork kind");
  const parse = (v) => {
    if (v === undefined) return null;
    if (
      typeof v !== "string" ||
      !/(Z|[+-]\d{2}:\d{2})$/.test(v) ||
      !Number.isFinite(Date.parse(v))
    )
      throw fail("Dates must be RFC3339 timestamps with timezone");
    return Date.parse(v);
  };
  const from = parse(query.from),
    to = parse(query.to);
  if (from !== null && to !== null && from >= to)
    throw fail("from must precede to");
  if (query.senderId !== undefined && typeof query.senderId !== "string")
    throw fail("senderId must be CSV");
  const senders = query.senderId ? query.senderId.split(",") : [];
  if (senders.length > 2 || senders.some((v) => !/^[0-9a-f-]{36}$/i.test(v)))
    throw fail("Invalid senderId filter");
  const q = query.q || "";
  if (typeof q !== "string" || q.length > 160)
    throw fail("Invalid search text");
  return { status, page, limit, kind, from, to, senders, q };
}
const list = handle(async (req, res, e) => {
  const pairId = await service.requirePair(e, req.userId);
  return sendSuccessResponse(
    res,
    200,
    "Artwork retrieved",
    await model.list(e.DB, pairId, filters(req.query)),
  );
});
const widgetState = handle(async (req, res, e) => {
  const pairId = await service.requirePair(e, req.userId),
    now = Date.now();
  const latest = async (kind) => {
    const row = await e.DB.prepare(
      postcard.joined +
        ` WHERE p.pair_id=? AND p.status='sent'
      AND m.kind=? AND (m.expires_at IS NULL OR m.expires_at>?)
      ORDER BY COALESCE(m.closed_at,p.sent_at) DESC,p.postcard_id DESC LIMIT 1`,
    )
      .bind(pairId, kind, now)
      .first();
    return row ? postcard.view(row) : null;
  };
  return sendSuccessResponse(res, 200, "Latest widgets", {
    doodle: await latest("doodle"),
    canvas: await latest("shared_canvas"),
    now: new Date(now).toISOString(),
  });
});
const doodle = handle(async (req, res, e) => {
  const pairId = await service.requirePair(e, req.userId),
    key = req.get("Idempotency-Key");
  if (typeof key !== "string" || !/^[0-9a-f-]{36}$/i.test(key))
    throw fail("UUID Idempotency-Key is required");
  if (!e.FILES) throw fail("R2 is unavailable", 503);
  const { files, fields } = await parseMultipartForm(req),
    file = files.file;
  const source = fields.source,
    caption = (fields.caption || "").trim();
  if (!["camera", "blank"].includes(source) || [...caption].length > 160)
    throw fail("Invalid source/caption");
  let width, height;
  const bytes = file?.buffer;
  if (!bytes || bytes.length > 10 * 1024 * 1024)
    throw fail("Image exceeds 10MB", 413);
  if (file.mimetype === "image/png" && bytes.length >= 24) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (file.mimetype === "image/jpeg") {
    for (let i = 2; i + 9 < bytes.length; ) {
      if (bytes[i++] !== 0xff) break;
      const marker = bytes[i++];
      if (marker === 0xd9 || marker === 0xda) break;
      const n = bytes.readUInt16BE(i);
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = bytes.readUInt16BE(i + 3);
        width = bytes.readUInt16BE(i + 5);
        break;
      }
      if (n < 2) break;
      i += n;
    }
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 4096 ||
    height > 4096
  )
    throw fail("Invalid image dimensions");
  const contentType = imageType(file, width, height);
  const payload = new Uint8Array(
    await new Blob([bytes, JSON.stringify({ source, caption })]).arrayBuffer(),
  );
  const payloadHash = Buffer.from(
    await crypto.subtle.digest("SHA-256", payload),
  ).toString("hex");
  const existing = await model.request(e.DB, pairId, req.userId, key);
  if (existing) {
    if (existing.payload_hash !== payloadHash)
      throw fail("Idempotency key payload mismatch", 409);
    return sendSuccessResponse(
      res,
      200,
      "Doodle already sent",
      postcard.view(await postcard.get(e.DB, existing.postcard_id)),
    );
  }
  const imageKey = `postcards/${pairId}/doodles/${crypto.randomUUID()}.${contentType === "image/png" ? "png" : "jpg"}`;
  await e.DB.prepare(
    "INSERT INTO postcard_image_cleanup(image_key,pair_id,not_before)VALUES(?,?,?)",
  )
    .bind(imageKey, pairId, Date.now() + 600000)
    .run();
  try {
    await e.FILES.put(imageKey, bytes, {
      httpMetadata: { contentType, cacheControl: "private, no-store" },
    });
    const item = await service.callRoom(e, pairId, "finalize-doodle", {
      userId: req.userId,
      requestKey: key,
      payloadHash,
      imageKey,
      contentType,
      width,
      height,
      source,
      caption,
    });
    const saved = await postcard.get(e.DB, item.postcardId);
    if (saved.image_key !== imageKey) {
      await e.FILES.delete(imageKey);
      await e.DB.prepare("DELETE FROM postcard_image_cleanup WHERE image_key=?")
        .bind(imageKey)
        .run();
    }
    return sendSuccessResponse(res, 201, "Doodle sent", item);
  } catch (error) {
    const committed = await model.request(e.DB, pairId, req.userId, key);
    if (committed && committed.payload_hash === payloadHash) {
      return sendSuccessResponse(
        res,
        200,
        "Doodle sent",
        postcard.view(await postcard.get(e.DB, committed.postcard_id)),
      );
    }
    throw error;
  }
});
module.exports = { capabilities, active, list, doodle, widgetState, filters };
