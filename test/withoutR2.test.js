const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { createTestServer, imageForm, sqlString } = require("./helpers/testServer");

const server = createTestServer({ withoutR2: true });
before(() => server.start(), { timeout: 90000 });
after(() => server.stop());

test("without R2: auth and JSON profile updates work, image endpoints return 503", async () => {
  const user = await server.createUser();
  const updated = await server.api("PUT", "/user-service/me", {
    token: user.token, json: { displayName: "No R2 User" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.userInfo.displayName, "No R2 User");

  for (const url of ["/user-service/me", "/scan-service/scans"]) {
    const result = await server.api(url.startsWith("/user") ? "PUT" : "POST", url, {
      token: user.token, form: imageForm({ label: "test", confidence: "0.9" }),
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "Feature Unavailable");
  }

  const file = await fetch(`${server.origin}/files/example.png`);
  assert.equal(file.status, 503);
  const docs = await fetch(`${server.origin}/api-docs`);
  assert.equal(docs.status, 200);
  assert.equal(server.sql("SELECT COUNT(*) AS count FROM scans")[0].count, 0);
});

test("without R2: existing scan records can still be deleted", async () => {
  const user = await server.createUser();
  const insertScan = (key) => server.sql(`INSERT INTO scans
    (key,user_id,label,confidence,time,image_url,type,is_rescan) VALUES
    (${sqlString(key)},${sqlString(user.userId)},'test',0.9,
    '2026-01-01T00:00:00.000Z','/files/old.png','skin',0)`);
  insertScan("no-r2-scan-1");
  assert.equal((await server.api("DELETE", "/scan-service/scans/no-r2-scan-1", {
    token: user.token,
  })).status, 200);
  insertScan("no-r2-scan-2");
  assert.equal((await server.api("DELETE", "/scan-service/scans", {
    token: user.token,
  })).status, 200);
  assert.equal(server.sql("SELECT COUNT(*) AS count FROM scans")[0].count, 0);
});
