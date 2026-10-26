const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { createTestServer, imageForm } = require("./helpers/testServer");

const server = createTestServer();
const { api } = server;
let origin;
before(async () => {
  await server.start();
  origin = server.origin;
}, { timeout: 90000 });
after(() => server.stop());

test("scan: all routes require authentication", async () => {
  for (const [method, url] of [
    ["GET", "/scan-service/scans"], ["POST", "/scan-service/scans"],
    ["PUT", "/scan-service/scans/missing"], ["DELETE", "/scan-service/scans/missing"],
    ["DELETE", "/scan-service/scans"],
  ]) {
    assert.equal((await api(method, url)).status, 401);
    assert.equal((await api(method, url, { token: "bad" })).status, 403);
  }
});

test("scan: another account cannot list, update, or delete an owner's scans", async () => {
  const owner = await server.createUser();
  const outsider = await server.createUser();
  const created = await api("POST", "/scan-service/scans", {
    token: owner.token, form: imageForm({ label: "Private", confidence: "0.7" }),
  });
  assert.equal(created.status, 201);
  const key = created.body.data.key;
  const list = await api("GET", "/scan-service/scans", { token: outsider.token });
  assert.deepEqual(list.body.data.data, []);
  assert.equal((await api("PUT", `/scan-service/scans/${key}`, { token: outsider.token, json: { label: "Changed" } })).status, 404);
  assert.equal((await api("DELETE", `/scan-service/scans/${key}`, { token: outsider.token })).status, 404);
  assert.equal((await api("DELETE", "/scan-service/scans", { token: outsider.token })).body.data.deletedCount, 0);
  assert.equal((await api("GET", "/scan-service/scans", { token: owner.token })).body.data.data[0].label, "Private");
  assert.equal((await api("DELETE", `/scan-service/scans/${key}`, { token: owner.token })).status, 200);
});

test("scan: create, list, update and delete with images in R2", async () => {
  const { token } = await server.createUser();
  const created = [];
  for (const label of ["Acne", "Eczema", "Mole"]) {
    const result = await api("POST", "/scan-service/scans", {
      token, form: imageForm({ label, confidence: "0.85" }),
    });
    assert.equal(result.status, 201);
    created.push(result.body.data);
  }
  assert.equal(created[0].type, "skin");
  assert.equal(created[0].isRescan, false);
  assert.ok(created[0].imageUrl.startsWith(`${origin}/files/user_scan_images/`));
  assert.equal((await fetch(created[0].imageUrl)).status, 200);

  assert.equal((await api("POST", "/scan-service/scans", {
    token, form: imageForm({ label: "Acne", confidence: "2" }),
  })).status, 400);
  assert.equal((await api("POST", "/scan-service/scans", {
    token, form: imageForm({ label: "Acne", confidence: "0.5" }, "big.png", new Array(10 * 1024 * 1024 + 1).fill(0)),
  })).status, 400);

  const page = await api("GET", "/scan-service/scans?page=1&limit=2&sortOrder=asc", { token });
  assert.equal(page.status, 200);
  assert.deepEqual(page.body.data.data.map((scan) => scan.label), ["Acne", "Eczema"]);
  assert.deepEqual(page.body.data.pagination, {
    currentPage: 1, totalPages: 2, totalItems: 3, itemsPerPage: 2, hasNextPage: true, hasPrevPage: false,
  });
  assert.equal((await api("GET", "/scan-service/scans?sortOrder=up", { token })).status, 400);

  const updated = await api("PUT", `/scan-service/scans/${created[0].key}`, {
    token, json: { label: "Rosacea", confidence: 0.4 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.label, "Rosacea");
  assert.equal(updated.body.data.confidence, 0.4);
  assert.ok(updated.body.data.updatedAt);
  assert.equal((await api("PUT", "/scan-service/scans/missing", {
    token, json: { label: "x" },
  })).status, 404);

  assert.equal((await api("DELETE", `/scan-service/scans/${created[0].key}`, { token })).status, 200);
  assert.equal((await fetch(created[0].imageUrl)).status, 404);
  assert.equal((await api("DELETE", `/scan-service/scans/${created[0].key}`, { token })).status, 404);

  const cleared = await api("DELETE", "/scan-service/scans", { token });
  assert.equal(cleared.body.data.deletedCount, 2);
  assert.equal((await fetch(created[1].imageUrl)).status, 404);
  assert.equal((await api("GET", "/scan-service/scans", { token })).body.data.pagination.totalItems, 0);
});

