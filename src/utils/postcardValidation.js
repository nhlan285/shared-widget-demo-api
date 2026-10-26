const fail = (message, status = 400) => Object.assign(new Error(message), { statusCode: status });
const color = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const id = (v) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(v);
const point = (p) => p && typeof p === "object" && !Array.isArray(p)
  && [p.x, p.y].every((n) => Number.isFinite(n) && n >= 0 && n <= 1);

const canvas = (body) => {
  if (!body || !Number.isInteger(body.width) || !Number.isInteger(body.height)
    || body.width < 1 || body.width > 4096 || body.height < 1 || body.height > 4096
    || !color(body.backgroundColor)) {
    throw fail("width/height must be integers from 1 to 4096; backgroundColor must be #RRGGBB");
  }
  return { width: body.width, height: body.height, backgroundColor: body.backgroundColor };
};

const applyEvent = (drawing, event, actorId, ownerId) => {
  if (!event || !id(event.eventId) || !Number.isInteger(event.baseRevision)) {
    throw fail("eventId and integer baseRevision are required");
  }
  const previous = drawing.recentEvents.find((e) => e.eventId === event.eventId && e.actorId === actorId);
  if (previous) return { drawing, duplicate: true, revision: previous.revision };
  // Independent strokes may interleave; events from before a clear must resync.
  if (event.baseRevision > drawing.revision || event.baseRevision < (drawing.clearRevision || 0)
    || event.baseRevision < drawing.revision - 128
    || event.baseRevision < 0) throw fail("Revision conflict; request sync before retrying", 409);
  const next = structuredClone(drawing);
  const stroke = next.strokes.find((s) => s.strokeId === event.strokeId);
  let payload;
  switch (event.type) {
    case "stroke.start":
      if (!id(event.strokeId) || stroke || !color(event.color)
        || !Number.isFinite(event.width) || event.width < 0.001 || event.width > 0.1
        || !point(event.point) || !["pen", "eraser"].includes(event.tool || "pen")) {
        throw fail("Invalid stroke start (normalized point/width, unique strokeId, #RRGGBB color)");
      }
      if (next.strokes.length >= 256) throw fail("Canvas supports at most 256 strokes", 413);
      if (next.strokes.some((s) => s.actorId === actorId && !s.ended)) throw fail("End your current stroke first", 409);
      payload = { strokeId: event.strokeId, color: event.color, width: event.width,
        tool: event.tool || "pen", point: { x: event.point.x, y: event.point.y } };
      next.strokes.push({ ...payload, actorId, points: [payload.point], ended: false });
      delete next.strokes.at(-1).point;
      break;
    case "stroke.append":
      if (!stroke || stroke.actorId !== actorId || stroke.ended || !Array.isArray(event.points) || event.points.length < 1
        || event.points.length > 64 || !event.points.every(point)) throw fail("Invalid stroke points (1-64)");
      payload = { strokeId: stroke.strokeId, points: event.points.map(({ x, y }) => ({ x, y })) };
      stroke.points.push(...payload.points);
      break;
    case "stroke.end":
      if (!stroke || stroke.actorId !== actorId || stroke.ended) throw fail("No own open stroke with this strokeId", 409);
      stroke.ended = true;
      payload = { strokeId: stroke.strokeId };
      break;
    case "stroke.remove":
      if (!stroke) throw fail("Unknown strokeId");
      if (stroke.actorId !== actorId) throw fail("You can only undo your own strokes", 403);
      next.strokes = next.strokes.filter((s) => s.strokeId !== stroke.strokeId);
      payload = { strokeId: stroke.strokeId };
      break;
    case "canvas.clear":
      if (actorId !== ownerId) throw fail("Only the postcard owner can clear the canvas", 403);
      if (event.baseRevision !== drawing.revision) throw fail("Sync before clearing the canvas", 409);
      next.strokes = [];
      next.clearRevision = next.revision + 1;
      payload = {};
      break;
    default: throw fail("Unknown drawing event type");
  }
  if (next.strokes.reduce((n, s) => n + s.points.length, 0) > 8000) throw fail("Canvas supports at most 8000 points", 413);
  next.revision++;
  next.recentEvents = [...next.recentEvents.slice(-127), { actorId, eventId: event.eventId, revision: next.revision }];
  return { drawing: next, payload, revision: next.revision, duplicate: false };
};

const imageType = (file, width, height) => {
  if (!file || !file.buffer.length) throw fail("PNG or JPEG image file is required");
  if (file.buffer.length > 10 * 1024 * 1024) throw fail("Image must not exceed 10 MB", 413);
  const b = file.buffer;
  if (file.mimetype === "image/png" && b.length >= 33
    && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    && b.toString("ascii", 12, 16) === "IHDR") {
    if (b.readUInt32BE(16) !== width || b.readUInt32BE(20) !== height) throw fail("Image dimensions must match the canvas");
    if (!b.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))) {
      throw fail("PNG is missing its IEND chunk");
    }
    return "image/png";
  }
  if (file.mimetype === "image/jpeg" && b.length >= 4 && b[0] === 255 && b[1] === 216
    && b[b.length - 2] === 255 && b[b.length - 1] === 217) {
    let offset = 2;
    while (offset + 4 <= b.length) {
      if (b[offset++] !== 255) break;
      while (b[offset] === 255) offset++;
      const marker = b[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > b.length) break;
      const size = b.readUInt16BE(offset);
      if (size < 2 || offset + size > b.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) {
        if (b.readUInt16BE(offset + 3) !== height || b.readUInt16BE(offset + 5) !== width) {
          throw fail("Image dimensions must match the canvas");
        }
        return "image/jpeg";
      }
      offset += size;
    }
  }
  throw fail("File content must match PNG or JPEG MIME type");
};

module.exports = { fail, canvas, applyEvent, imageType };
