// Isolated synthetic Doodle only. Does not touch shared canvases or real accounts.
import fs from "node:fs";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
const config = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
assert.equal(config.name, "shared-widget-demo-api");
assert.equal(config.account_id, "4bce5751f79111fc1541214fecffd713");
assert.equal(config.d1_databases[0].database_id, "59e3b722-e516-44e9-a228-5e6a450db40b");
const fixture = JSON.parse(fs.readFileSync(".local/smoke-session.json", "utf8"));
const origin = "https://shared-widget-demo-api.nguyennhatlan285.workers.dev";
assert.equal(fixture.origin, origin);
const [a, b] = fixture.users;
async function api(method, path, user, body, headers = {}) {
  const result = await fetch(origin + "/v1" + path, { method, body,
    headers: { ...headers, Authorization: `Bearer ${user.accessToken}` },
    signal: AbortSignal.timeout(20000) });
  const value = await result.json();
  assert(result.ok, `Request failed with ${result.status}`);
  return value.data;
}
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", "base64");
const form = new FormData();
form.append("file", new Blob([png], { type: "image/png" }), "retention.png");
form.append("source", "blank");
form.append("caption", "Retention QA (synthetic)");
const item = await api("POST", "/postcards/doodles", a, form,
  { "Idempotency-Key": randomUUID() });
const quote = v => "'" + String(v).replaceAll("'", "''") + "'";
const sent = Date.now() - 86400001, expires = sent + 86400000;
// Time travel only the item created above, within the owned fixture pair.
const sql = `UPDATE postcards SET sent_at=${sent} WHERE postcard_id=${quote(item.postcardId)}
  AND pair_id=${quote(fixture.pairId)} AND sender_id=${quote(a.userId)};
UPDATE creation_metadata SET expires_at=${expires} WHERE postcard_id IN
  (SELECT postcard_id FROM postcards WHERE postcard_id=${quote(item.postcardId)}
    AND pair_id=${quote(fixture.pairId)} AND sender_id=${quote(a.userId)});`;
fs.writeFileSync(".local/retention-fixture.sql", sql);
execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB",
  "--remote", "--config", "wrangler.jsonc", "--file", ".local/retention-fixture.sql"],
  { stdio: "pipe", windowsHide: true, timeout: 60000 });
const detail = await api("GET", `/postcards/${item.postcardId}`, b);
assert(Date.parse(detail.expiresAt) <= Date.now());
const image = await fetch(origin + item.imageUrl, {
  headers: { Authorization: `Bearer ${b.accessToken}` }, signal: AbortSignal.timeout(20000) });
assert.equal(image.status, 200);
assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
assert.match(image.headers.get("cache-control"), /private/);
const widgets = await api("GET", "/postcards/widget-state", b);
assert.notEqual(widgets.doodle?.postcardId, item.postcardId);
const from = encodeURIComponent(new Date(sent - 1000).toISOString());
const to = encodeURIComponent(new Date(sent + 1000).toISOString());
const archive = await api("GET", `/postcards?kind=doodle&from=${from}&to=${to}`, b);
assert(archive.postcards.some(p => p.postcardId === item.postcardId));
console.log(JSON.stringify({ retainedLibraryImage: true, dateFilter: true,
  hiddenFromWidget: true, privateImage: true, postcardId: item.postcardId }));
