// Explicit DB arguments: Durable Objects must not use the Worker's global bindings.
const currentPair = (db, userId) => db.prepare(`SELECT p.pair_id FROM pairs p
  JOIN pair_members m ON m.pair_id = p.pair_id
  JOIN users u ON u.user_id = m.user_id
  WHERE m.user_id = ? AND m.left_at IS NULL AND p.status = 'active' AND u.is_active = 1`)
  .bind(userId).first();

const get = (db, id) => db.prepare("SELECT * FROM postcards WHERE postcard_id = ?").bind(id).first();

const view = (row) => ({
  postcardId: row.postcard_id, pairId: row.pair_id,
  senderId: row.sender_id, recipientId: row.recipient_id, status: row.status,
  width: row.width, height: row.height, backgroundColor: row.background_color,
  revision: row.status === "sent" ? row.revision : null, createdAt: new Date(row.created_at).toISOString(),
  sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  imageUrl: row.image_key ? `/v1/postcards/${row.postcard_id}/image` : null,
  downloadUrl: row.image_key ? `/v1/postcards/${row.postcard_id}/image?download=1` : null,
});

const create = async (db, pairId, userId, canvas) => {
  const id = crypto.randomUUID();
  // Validate membership again in the write to avoid creating into an archived pair.
  await db.prepare(`INSERT INTO postcards
    (postcard_id,pair_id,sender_id,recipient_id,width,height,background_color,created_at)
    SELECT ?,p.pair_id,me.user_id,other.user_id,?,?,?,?
    FROM pairs p JOIN pair_members me ON me.pair_id = p.pair_id
    JOIN pair_members other ON other.pair_id = p.pair_id AND other.user_id <> me.user_id
    WHERE p.pair_id = ? AND p.status = 'active' AND me.user_id = ?
      AND me.left_at IS NULL AND other.left_at IS NULL`)
    .bind(id, canvas.width, canvas.height, canvas.backgroundColor, Date.now(), pairId, userId).run();
  return get(db, id);
};

const drafts = async (db, pairId) => (await db.prepare(
  "SELECT * FROM postcards WHERE pair_id = ? AND status = 'draft' ORDER BY created_at, postcard_id"
).bind(pairId).all()).results;

const list = async (db, pairId, status, limit, offset) => {
  const order = status === "sent" ? "sent_at" : "created_at";
  const rows = (await db.prepare(`SELECT * FROM postcards WHERE pair_id = ? AND status = ?
    ORDER BY ${order} DESC, postcard_id DESC LIMIT ? OFFSET ?`)
    .bind(pairId, status, limit, offset).all()).results;
  return rows.map(view);
};

const finalize = async (db, id, userId, drawing, imageKey, contentType) => {
  const results = await db.batch([db.prepare(`UPDATE postcards
  SET status = 'sent', revision = ?, drawing_json = ?, image_key = ?, image_content_type = ?, sent_at = ?
  WHERE postcard_id = ? AND sender_id = ? AND status = 'draft'
    AND EXISTS (SELECT 1 FROM pairs p JOIN pair_members m ON m.pair_id = p.pair_id
      WHERE p.pair_id = postcards.pair_id AND p.status = 'active'
        AND m.user_id = ? AND m.left_at IS NULL)`)
  .bind(drawing.revision, JSON.stringify(drawing), imageKey, contentType, Date.now(), id, userId, userId),
  db.prepare(`DELETE FROM postcard_image_cleanup WHERE image_key = ?
    AND EXISTS (SELECT 1 FROM postcards WHERE postcard_id = ? AND image_key = ? AND status = 'sent')`)
    .bind(imageKey, id, imageKey)]);
  return results[0];
};

module.exports = { currentPair, get, view, create, drafts, list, finalize };
