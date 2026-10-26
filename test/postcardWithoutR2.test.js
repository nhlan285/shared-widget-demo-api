const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const { createTestServer, imageForm } = require("./helpers/testServer");

const server = createTestServer({ withoutR2: true });
before(() => server.start(), { timeout: 90000 });
after(() => server.stop());

test("postcards without R2: drafts and tickets work, send returns 503 and releases its lock", async () => {
  const { a } = await server.connect();
  const draft = await server.api("POST", "/postcards/drafts", {
    token: a.token, json: { width: 1, height: 1, backgroundColor: "#ffffff" },
  });
  assert.equal(draft.status, 201);
  const id = draft.body.data.postcardId;
  const ticket = await server.api("POST", "/postcards/realtime-ticket", { token: a.token });
  assert.equal(ticket.status, 201);
  const locked = await server.api("POST", `/postcards/${id}/lock`, { token: a.token, json: { revision: 0 } });
  assert.equal(locked.status, 200);
  const sent = await server.api("POST", `/postcards/${id}/send`, {
    token: a.token, form: imageForm({ revision: "0", lockId: locked.body.data.lockId }),
  });
  assert.equal(sent.status, 503);
  const current = await server.api("GET", `/postcards/${id}`, { token: a.token });
  assert.equal(current.body.data.status, "draft");
  assert.equal(current.body.data.drawing.locked, false);
});
