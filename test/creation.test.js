const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { randomUUID } = require("node:crypto");
const {
  createTestServer,
  imageForm,
  sqlString,
} = require("./helpers/testServer");
const server = createTestServer();
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
  "base64",
);
before(() => server.start(), { timeout: 90000 });
after(() => server.stop());
const draft = (u) =>
  server.api("POST", "/postcards/drafts", {
    token: u.token,
    json: {
      width: 1,
      height: 1,
      backgroundColor: "#ffffff",
      kind: "shared_canvas",
    },
  });
const send = (u, key, caption = "Hello") =>
  server.api("POST", "/postcards/doodles", {
    token: u.token,
    headers: { "Idempotency-Key": key },
    form: imageForm({ source: "camera", caption }, "doodle.png", png),
  });

test("creation: singleton race joins winner, only owner closes and next page gets a new owner", async () => {
  const { a, b } = await server.connect();
  const results = await Promise.all([draft(a), draft(b)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const created = results.find((r) => r.status === 201).body.data,
    owner = created.senderId === a.userId ? a : b;
  const partner = owner === a ? b : a,
    conflict = results.find((r) => r.status === 409);
  assert.equal(conflict.body.data.activePostcardId, created.postcardId);
  const active = await server.api("GET", "/postcards/active-canvas", {
    token: partner.token,
  });
  assert.equal(active.body.data.postcardId, created.postcardId);
  assert.equal(
    (
      await server.api("POST", `/postcards/${created.postcardId}/lock`, {
        token: partner.token,
        json: { revision: 0 },
      })
    ).status,
    403,
  );
  const locked = await server.api(
    "POST",
    `/postcards/${created.postcardId}/lock`,
    {
      token: owner.token,
      json: { revision: 0 },
    },
  );
  assert.equal(locked.status, 200);
  const close = () =>
    server.api("POST", `/postcards/${created.postcardId}/close`, {
      token: owner.token,
      form: imageForm(
        {
          title: "First together",
          revision: "0",
          lockId: locked.body.data.lockId,
        },
        "canvas.png",
        png,
      ),
    });
  const saved = await close();
  assert.equal(saved.status, 200);
  assert.equal(saved.body.data.status, "saved");
  assert.equal(saved.body.data.title, "First together");
  assert.equal((await close()).body.data.postcardId, created.postcardId);
  assert.equal(
    (
      await server.api("GET", "/postcards/active-canvas", {
        token: partner.token,
      })
    ).body.data,
    null,
  );
  const again = await draft(partner);
  assert.equal(again.status, 201);
  assert.equal(again.body.data.senderId, partner.userId);
  const widgets = await server.api("GET", "/postcards/widget-state", {
    token: partner.token,
  });
  assert.equal(widgets.body.data.canvas.postcardId, created.postcardId);
  const archive = await server.api("GET", "/postcards?status=saved&q=First", {
    token: owner.token,
  });
  assert.equal(archive.body.data.postcards.length, 1);
  assert.equal(archive.body.data.hasMore, false);
});
test("creation: private camera/blank Doodles, idempotent race, widget-only TTL, retained private image and sender/date filters", async () => {
  const { a, b } = await server.connect(),
    key = randomUUID();
  const replies = await Promise.all([send(a, key), send(a, key)]);
  assert(
    replies.every((r) => [200, 201].includes(r.status)),
    JSON.stringify(replies.map((r) => r.body)),
  );
  const item = replies[0].body.data;
  assert.equal(replies[1].body.data.postcardId, item.postcardId);
  assert.equal(item.kind, "doodle");
  assert.equal(Date.parse(item.expiresAt) - Date.parse(item.sentAt), 86400000);
  assert.equal((await send(a, key, "Different")).status, 409);
  assert.equal(
    (await server.api("GET", "/postcards?status=draft", { token: b.token }))
      .body.data.postcards.length,
    0,
  );
  const filtered = await server.api(
    "GET",
    `/postcards?kind=doodle&senderId=${a.userId}&from=2020-01-01T00:00:00Z&to=2030-01-01T00:00:00Z`,
    { token: b.token },
  );
  assert.equal(filtered.body.data.postcards.length, 1);
  // Synchronous SQL CLI below can outlive keep-alive; do not reuse stale sockets.
  const image = await fetch(server.origin + item.imageUrl, {
    headers: { Authorization: `Bearer ${b.token}`, Connection: "close" },
  });
  assert.equal(image.status, 200);
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
  const raw = server.sql(
    `SELECT image_key FROM postcards WHERE postcard_id=${sqlString(item.postcardId)}`,
  )[0];
  assert.equal(
    (await fetch(server.origin + "/files/" + raw.image_key, {
      headers: { Connection: "close" },
    })).status,
    404,
  );
  server.sql(
    `UPDATE creation_metadata SET expires_at=1,expiry_queued=1 WHERE postcard_id=${sqlString(item.postcardId)}`,
  );
  // Simulate an expiry cleanup entry left by the previous demo policy.
  server.sql(`INSERT INTO postcard_image_cleanup(image_key,pair_id,not_before)
    SELECT image_key,pair_id,0 FROM postcards WHERE postcard_id=${sqlString(item.postcardId)}`);
  const tick = await fetch(server.origin + "/__scheduled", {headers:{Connection:"close"}});
  assert.equal(tick.status,200);
  await tick.text();
  const retained = await fetch(server.origin + item.imageUrl, {
    headers: { Authorization: `Bearer ${b.token}`, Connection: "close" },
  });
  assert.equal(retained.status,200);
  assert.deepEqual(Buffer.from(await retained.arrayBuffer()),png);
  assert.equal(server.sql(`SELECT COUNT(*) AS n FROM postcard_image_cleanup
    WHERE image_key=${sqlString(raw.image_key)}`)[0].n,0);
  const archive = await server.api("GET","/postcards?kind=doodle",{token:b.token});
  assert.equal(archive.body.data.postcards[0].postcardId,item.postcardId);
  assert.equal(
    (await server.api("GET", "/postcards/widget-state", { token: b.token }))
      .body.data.doodle,
    null,
  );
  const outsider = await server.createUser();
  assert.equal((await server.api("GET",item.imageUrl.replace("/v1",""),
    {token:outsider.token})).status,403);
  assert.equal((await server.api("POST","/pairs/current/disconnect",{token:a.token})).status,200);
  assert.equal((await server.api("GET",item.imageUrl.replace("/v1",""),
    {token:b.token})).status,403);
});
