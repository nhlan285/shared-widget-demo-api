const assert = require("node:assert/strict");
const { test } = require("node:test");
const { applyEvent, imageType } = require("../src/utils/postcardValidation");

const fresh = () => ({ revision: 0, clearRevision: 0, strokes: [], recentEvents: [] });
const start = { type: "stroke.start", eventId: "a1", baseRevision: 0,
  strokeId: "stroke-a", color: "#ffffff", width: 0.01, point: { x: 0, y: 1 } };

test("postcard drawing: limits, invalid coordinates, own-stroke editing and clear generation", () => {
  let drawing = applyEvent(fresh(), start, "a", "a").drawing;
  const append = { type: "stroke.append", eventId: "a2", baseRevision: 1,
    strokeId: "stroke-a", points: [{ x: 0.5, y: 0.5 }] };
  assert.throws(() => applyEvent(drawing, append, "b", "a"));
  assert.throws(() => applyEvent(drawing, { ...append, points: [{ x: 2, y: 0 }] }, "a", "a"));
  assert.throws(() => applyEvent(drawing, { ...append, points: Array(65).fill({ x: 0, y: 0 }) }, "a", "a"));
  assert.throws(() => applyEvent(drawing, { ...start, eventId: "again", strokeId: "new" }, "a", "a"));
  drawing = applyEvent(drawing, { type: "canvas.clear", eventId: "clear", baseRevision: 1 }, "a", "a").drawing;
  assert.throws(() => applyEvent(drawing, { ...start, eventId: "stale", strokeId: "new" }, "b", "a"));
  assert.equal(drawing.strokes.length, 0);
  assert.equal(drawing.clearRevision, 2);
});

test("postcard image: rejects wrong MIME, dimensions, truncation and oversized images", () => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
  assert.equal(imageType({ mimetype: "image/png", buffer: bytes }, 1, 1), "image/png");
  assert.throws(() => imageType({ mimetype: "image/png", buffer: bytes }, 2, 1));
  assert.throws(() => imageType({ mimetype: "image/jpeg", buffer: bytes }, 1, 1));
  assert.throws(() => imageType({ mimetype: "image/png", buffer: bytes.subarray(0, 33) }, 1, 1));
  assert.throws(() => imageType({ mimetype: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }, 1, 1));
});
