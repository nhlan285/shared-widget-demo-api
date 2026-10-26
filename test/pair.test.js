const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const jwt = require("jsonwebtoken");
const { createTestServer, JWT_SECRET, sqlString } = require("./helpers/testServer");

const server = createTestServer();
const { api } = server;
before(() => server.start(), { timeout: 90000 });
after(() => server.stop());

test("pairs: every route requires a valid token and user identity", async () => {
  const expired = jwt.sign({ userId: "expired" }, JWT_SECRET, { expiresIn: -1 });
  const noIdentity = jwt.sign({}, JWT_SECRET, { expiresIn: "1h" });
  for (const [method, url] of [
    ["GET", "/pairs/current"], ["PATCH", "/pairs/current"],
    ["POST", "/pairs/current/disconnect"],
  ]) {
    for (const [token, status] of [[undefined, 401], ["bad", 403], [expired, 403], [noIdentity, 403]]) {
      assert.equal((await api(method, url, { token })).status, status, `${method} ${url}`);
    }
  }
});

test("pairs: an unpaired user sees null and cannot update or disconnect", async () => {
  const user = await server.createUser();
  const current = await server.currentPair(user);
  assert.equal(current.status, 200);
  assert.equal(current.body.data, null);
  assert.equal((await api("PATCH", "/pairs/current", {
    token: user.token, json: { anniversaryDate: "2026-10-19" },
  })).status, 404);
  assert.equal((await api("POST", "/pairs/current/disconnect", { token: user.token })).status, 404);
});

test("pairs: both members see the same private space, outsiders do not", async () => {
  const { a, b, pairId } = await server.connect();
  const outsider = await server.createUser();
  for (const user of [a, b]) {
    const current = await server.currentPair(user);
    assert.equal(current.body.data.pairId, pairId);
    assert.equal(current.body.data.timezone, "Asia/Ho_Chi_Minh");
    assert.equal(current.body.data.anniversaryDate, null);
    assert.deepEqual(current.body.data.members.map((m) => m.userId).sort(), [a.userId, b.userId].sort());
    assert.deepEqual(current.body.data.members.map((m) => m.slot), [1, 2]);
    for (const member of current.body.data.members) {
      assert.deepEqual(Object.keys(member).sort(), ["displayName", "slot", "userId"]);
    }
  }
  assert.equal((await server.currentPair(outsider)).body.data, null);
  assert.equal((await api("PATCH", "/pairs/current", {
    token: outsider.token, json: { anniversaryDate: null },
  })).status, 404);
  assert.equal((await api("POST", "/pairs/current/disconnect", { token: outsider.token })).status, 404);
  assert.equal((await server.currentPair(a)).body.data.pairId, pairId);
});

test("pairs: anniversary validates the calendar date and either member can change it", async () => {
  const { a, b, pairId } = await server.connect();
  for (const json of [
    {}, [], { anniversaryDate: "2026-02-30" }, { anniversaryDate: "2025-02-29" },
    { anniversaryDate: "19/10/2026" }, { anniversaryDate: 123 },
    { anniversaryDate: null, timezone: "UTC" }, { anniversaryDate: null, pairId: "other" },
  ]) {
    const response = await api("PATCH", "/pairs/current", { token: a.token, json });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, "Validation Failed");
  }
  const changed = await api("PATCH", "/pairs/current", {
    token: a.token, json: { anniversaryDate: "2028-02-29" },
  });
  assert.equal(changed.status, 200);
  assert.deepEqual(changed.body.data, { pairId, anniversaryDate: "2028-02-29" });
  assert.equal((await server.currentPair(b)).body.data.anniversaryDate, "2028-02-29");
  const cleared = await api("PATCH", "/pairs/current", {
    token: b.token, json: { anniversaryDate: null },
  });
  assert.equal(cleared.status, 200);
  assert.equal((await server.currentPair(a)).body.data.anniversaryDate, null);
});

test("pairs: disconnect releases both members, blocks the old invitation and allows a new pair", async () => {
  const { a, b, invitation, pairId } = await server.connect();
  const response = await api("POST", "/pairs/current/disconnect", { token: b.token });
  assert.equal(response.status, 200);
  assert.equal(response.body.data, null);
  for (const user of [a, b]) {
    assert.equal((await server.currentPair(user)).body.data, null);
    assert.equal((await api("PATCH", "/pairs/current", {
      token: user.token, json: { anniversaryDate: null },
    })).status, 404);
  }
  assert.equal((await api("POST", "/pairs/current/disconnect", { token: a.token })).status, 404);
  assert.equal((await server.acceptCode(b, invitation)).status, 409);
  const [row] = server.sql(`SELECT status, (SELECT COUNT(*) FROM pair_members WHERE pair_id=p.pair_id AND left_at IS NULL) AS active_members FROM pairs p WHERE pair_id=${sqlString(pairId)}`);
  assert.equal(row.status, "archived");
  assert.equal(row.active_members, 0);
  const c = await server.createUser();
  const nextInvitation = await server.createInvitation(a);
  const next = await server.acceptCode(c, nextInvitation);
  assert.equal(next.status, 201);
  assert.notEqual(next.body.data.pairId, pairId);
  assert.equal((await server.currentPair(b)).body.data, null);
  assert.deepEqual((await server.currentPair(c)).body.data.members.map((m) => m.userId).sort(), [a.userId, c.userId].sort());
});
