// Failed deletes stay queued for the hourly scheduled retry.
const cleanupPostcardImages = async (env, pairId = null) => {
  if (!env.FILES) return;
  const now=Date.now();
  // TTL is enforced synchronously by the image endpoint; cron reclaims R2 later.
  const expired=(await env.DB.prepare(`SELECT p.postcard_id,p.image_key,p.pair_id
    FROM postcards p JOIN creation_metadata m ON m.postcard_id=p.postcard_id
    WHERE m.kind='doodle' AND m.expires_at<=? AND m.expiry_queued=0 LIMIT 100`)
    .bind(now).all()).results;
  if(expired.length)await env.DB.batch(expired.flatMap(row=>[
    env.DB.prepare("INSERT OR IGNORE INTO postcard_image_cleanup(image_key,pair_id,not_before)VALUES(?,?,0)")
      .bind(row.image_key,row.pair_id),
    env.DB.prepare("UPDATE creation_metadata SET expiry_queued=1 WHERE postcard_id=?").bind(row.postcard_id),
  ]));
  const query = pairId
    ? env.DB.prepare("SELECT image_key FROM postcard_image_cleanup WHERE not_before <= ? AND pair_id = ? LIMIT 100").bind(Date.now(), pairId)
    : env.DB.prepare("SELECT image_key FROM postcard_image_cleanup WHERE not_before <= ? LIMIT 100").bind(Date.now());
  const { results } = await query.all();
  if (!results.length) return;
  await env.FILES.delete(results.map((r) => r.image_key));
  await env.DB.batch(results.map((r) => env.DB.prepare(
    "DELETE FROM postcard_image_cleanup WHERE image_key = ? AND not_before <= ?"
  ).bind(r.image_key, Date.now())));
};

const cleanupPostcardRooms = async (env) => {
  if (!env.POSTCARD_ROOMS) return;
  const { results } = await env.DB.prepare("SELECT pair_id FROM postcard_room_cleanup LIMIT 100").all();
  for (const { pair_id: pairId } of results) {
    const stub = env.POSTCARD_ROOMS.get(env.POSTCARD_ROOMS.idFromName(pairId));
    const response = await stub.fetch(new Request("https://postcard.internal/disconnect", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pairId }),
    }));
    if (!response.ok) throw new Error(`Could not clean postcard room: ${response.status}`);
  }
};

module.exports = { cleanupPostcardImages, cleanupPostcardRooms };
