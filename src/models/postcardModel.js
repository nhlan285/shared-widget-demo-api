// Explicit DB arguments: Durable Objects must not use the Worker's global bindings.
const currentPair = (db, userId) => db.prepare(`SELECT p.pair_id FROM pairs p
  JOIN pair_members m ON m.pair_id = p.pair_id
  JOIN users u ON u.user_id = m.user_id
  WHERE m.user_id = ? AND m.left_at IS NULL AND p.status = 'active' AND u.is_active = 1`)
  .bind(userId).first();

const joined = `SELECT p.*,m.kind,m.title,m.source,m.expires_at,m.closed_at
  FROM postcards p LEFT JOIN creation_metadata m ON m.postcard_id=p.postcard_id`;
const get = (db, id) => db.prepare(joined + " WHERE p.postcard_id = ?").bind(id).first();

const view = (row) => ({
  postcardId: row.postcard_id, pairId: row.pair_id,
  senderId: row.sender_id, recipientId: row.recipient_id,
  status: row.kind === "shared_canvas" && row.status === "sent" ? "saved" : row.status,
  ...(row.kind ? { kind: row.kind, title: row.title || "", source: row.source,
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null } : {}),
  width: row.width, height: row.height, backgroundColor: row.background_color,
  revision: row.status === "sent" ? row.revision : null, createdAt: new Date(row.created_at).toISOString(),
  sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
  imageUrl: row.image_key ? `/v1/postcards/${row.postcard_id}/image` : null,
  downloadUrl: row.image_key ? `/v1/postcards/${row.postcard_id}/image?download=1` : null,
});

const create = async (db, pairId, userId, canvas, kind) => {
  const id = crypto.randomUUID();
  // Validate membership again in the write to avoid creating into an archived pair.
  const insert = db.prepare(`INSERT INTO postcards
    (postcard_id,pair_id,sender_id,recipient_id,width,height,background_color,created_at)
    SELECT ?,p.pair_id,me.user_id,other.user_id,?,?,?,?
    FROM pairs p JOIN pair_members me ON me.pair_id = p.pair_id
    JOIN pair_members other ON other.pair_id = p.pair_id AND other.user_id <> me.user_id
    WHERE p.pair_id = ? AND p.status = 'active' AND me.user_id = ?
      AND me.left_at IS NULL AND other.left_at IS NULL`)
    .bind(id, canvas.width, canvas.height, canvas.backgroundColor, Date.now(), pairId, userId);
  if (kind === "shared_canvas") {
    await db.batch([insert,
      db.prepare("INSERT INTO creation_metadata(postcard_id,kind) SELECT postcard_id,'shared_canvas' FROM postcards WHERE postcard_id=?").bind(id),
      db.prepare("INSERT INTO active_shared_canvases(pair_id,postcard_id) SELECT pair_id,postcard_id FROM postcards WHERE postcard_id=?").bind(id)]);
  } else await insert.run();
  return get(db, id);
};

const drafts = async (db, pairId) => (await db.prepare(
  joined + " WHERE p.pair_id = ? AND p.status = 'draft' ORDER BY p.created_at, p.postcard_id"
).bind(pairId).all()).results;

const list = async (db, pairId, status, limit, offset) => {
  const order = status === "sent" ? "sent_at" : "created_at";
  const rows = (await db.prepare(joined + ` WHERE p.pair_id = ? AND p.status = ?
    ORDER BY p.${order} DESC, p.postcard_id DESC LIMIT ? OFFSET ?`)
    .bind(pairId, status, limit, offset).all()).results;
  return rows.map(view);
};

const finalize = async (db, id, userId, drawing, imageKey, contentType, title) => {
  const results = await db.batch([db.prepare(`UPDATE postcards
  SET status = 'sent', revision = ?, drawing_json = ?, image_key = ?, image_content_type = ?, sent_at = ?
  WHERE postcard_id = ? AND sender_id = ? AND status = 'draft'
    AND EXISTS (SELECT 1 FROM pairs p JOIN pair_members m ON m.pair_id = p.pair_id
      WHERE p.pair_id = postcards.pair_id AND p.status = 'active'
        AND m.user_id = ? AND m.left_at IS NULL)`)
  .bind(drawing.revision, JSON.stringify(drawing), imageKey, contentType, Date.now(), id, userId, userId),
  db.prepare(`DELETE FROM postcard_image_cleanup WHERE image_key = ?
    AND EXISTS (SELECT 1 FROM postcards WHERE postcard_id = ? AND image_key = ? AND status = 'sent')`)
    .bind(imageKey, id, imageKey),
  db.prepare(`UPDATE creation_metadata SET title=?,closed_at=?
    WHERE postcard_id=? AND kind='shared_canvas'
    AND EXISTS(SELECT 1 FROM postcards WHERE postcard_id=? AND status='sent')`)
    .bind(title || "", Date.now(), id, id),
  db.prepare(`DELETE FROM active_shared_canvases WHERE postcard_id=?
    AND EXISTS(SELECT 1 FROM postcards WHERE postcard_id=? AND status='sent')`).bind(id,id)]);
  return results[0];
};

module.exports = { currentPair, get, view, create, drafts, list, finalize, joined };
