const postcard = require("./postcardModel");
const activeId = (db, pairId) =>
  db
    .prepare("SELECT postcard_id FROM active_shared_canvases WHERE pair_id=?")
    .bind(pairId)
    .first();
const request = (db, pairId, userId, key) =>
  db
    .prepare(
      "SELECT * FROM doodle_requests WHERE pair_id=? AND user_id=? AND request_key=?",
    )
    .bind(pairId, userId, key)
    .first();
async function saveDoodle(db, data) {
  const id = crypto.randomUUID(),
    now = Date.now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO postcards(postcard_id,pair_id,sender_id,recipient_id,
      status,width,height,background_color,revision,drawing_json,image_key,
      image_content_type,created_at,sent_at)
      SELECT ?,p.pair_id,me.user_id,other.user_id,'sent',?,?,'#ffffff',0,NULL,?,?,?,?
      FROM pairs p JOIN pair_members me ON me.pair_id=p.pair_id
      JOIN pair_members other ON other.pair_id=p.pair_id AND other.user_id<>me.user_id
      WHERE p.pair_id=? AND p.status='active' AND me.user_id=?
      AND me.left_at IS NULL AND other.left_at IS NULL`,
      )
      .bind(
        id,
        data.width,
        data.height,
        data.imageKey,
        data.contentType,
        now,
        now,
        data.pairId,
        data.userId,
      ),
    db
      .prepare(
        `INSERT INTO creation_metadata(postcard_id,kind,title,source,expires_at,idempotency_key,payload_hash)
      SELECT postcard_id,'doodle',?,?,?,?,? FROM postcards WHERE postcard_id=?`,
      )
      .bind(
        data.caption,
        data.source,
        now + 86400000,
        data.requestKey,
        data.payloadHash,
        id,
      ),
    db
      .prepare(
        `INSERT INTO doodle_requests(pair_id,user_id,request_key,payload_hash,postcard_id)
      SELECT pair_id,sender_id,?,?,postcard_id FROM postcards WHERE postcard_id=?`,
      )
      .bind(data.requestKey, data.payloadHash, id),
    db
      .prepare(
        `DELETE FROM postcard_image_cleanup WHERE image_key=? AND EXISTS
      (SELECT 1 FROM postcards WHERE postcard_id=? AND image_key=?)`,
      )
      .bind(data.imageKey, id, data.imageKey),
  ]);
  return postcard.get(db, id);
}
async function list(db, pairId, filters) {
  const where = ["p.pair_id=?", "p.status=?"],
    values = [pairId, filters.status === "saved" ? "sent" : filters.status];
  if (filters.status === "saved") where.push("m.kind='shared_canvas'");
  if (filters.status === "sent")
    where.push("COALESCE(m.kind,'legacy')<>'shared_canvas'");
  if (filters.kind) {
    where.push("m.kind=?");
    values.push(filters.kind);
  }
  const date = "COALESCE(m.closed_at,p.sent_at,p.created_at)";
  if (filters.from !== null) {
    where.push(date + ">=?");
    values.push(filters.from);
  }
  if (filters.to !== null) {
    where.push(date + "<?");
    values.push(filters.to);
  }
  if (filters.senders.length) {
    where.push(
      "p.sender_id IN (" + filters.senders.map(() => "?").join(",") + ")",
    );
    values.push(...filters.senders);
  }
  if (filters.q) {
    where.push("LOWER(COALESCE(m.title,'')) LIKE ? ESCAPE '\\'");
    values.push("%" + filters.q.toLowerCase().replace(/[\\%_]/g, "\\$&") + "%");
  }
  const rows = (
    await db
      .prepare(
        postcard.joined +
          " WHERE " +
          where.join(" AND ") +
          " ORDER BY " +
          date +
          " DESC,p.postcard_id DESC LIMIT ? OFFSET ?",
      )
      .bind(...values, filters.limit + 1, (filters.page - 1) * filters.limit)
      .all()
  ).results;
  return {
    postcards: rows.slice(0, filters.limit).map(postcard.view),
    page: filters.page,
    limit: filters.limit,
    hasMore: rows.length > filters.limit,
  };
}
module.exports = { activeId, request, saveDoodle, list };
