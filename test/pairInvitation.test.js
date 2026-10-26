const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { before, after, test } = require("node:test");
const jwt = require("jsonwebtoken");
const { createTestServer, linkInput, sqlString, JWT_SECRET } = require("./helpers/testServer");

const server = createTestServer();
const { api } = server;
before(() => server.start(), { timeout: 90000 });
after(() => server.stop());

test("invitations: every route requires a valid token and user identity", async () => {
  const expired = jwt.sign({ userId: "expired" }, JWT_SECRET, { expiresIn: -1 });
  const noIdentity = jwt.sign({}, JWT_SECRET, { expiresIn: "1h" });
  for (const [method, url] of [
    ["POST", "/pair-invitations"], ["POST", "/pair-invitations/preview"],
    ["POST", "/pair-invitations/accept"], ["DELETE", `/pair-invitations/${randomUUID()}`],
  ]) {
    for (const [token, status] of [[undefined, 401], ["bad", 403], [expired, 403], [noIdentity, 403]]) {
      assert.equal((await api(method, url, { token })).status, status, `${method} ${url}`);
    }
  }
});

test("invitations: reject ambiguous/malformed input and unknown credentials", async () => {
  const user = await server.createUser();
  for (const endpoint of ["preview", "accept"]) {
    assert.equal((await api("POST", `/pair-invitations/${endpoint}`, { token: user.token })).status, 400);
    for (const json of [
      {}, [], { code: "short" }, { code: 12345678 }, { linkToken: "bad" },
      { linkToken: "A".repeat(64) }, { code: "K8P3M7Q2", linkToken: "a".repeat(64) },
      { code: "K8P3M7Q2", userId: "other" }, { invitationId: randomUUID() },
    ]) {
      const response = await api("POST", `/pair-invitations/${endpoint}`, { token: user.token, json });
      assert.equal(response.status, 400, JSON.stringify(json));
    }
    for (const json of [{ code: "00000000" }, { linkToken: "0".repeat(64) }]) {
      assert.equal((await api("POST", `/pair-invitations/${endpoint}`, { token: user.token, json })).status, 404);
    }
  }
  assert.equal((await api("DELETE", "/pair-invitations/not-a-uuid", { token: user.token })).status, 400);
  assert.equal((await api("DELETE", `/pair-invitations/${randomUUID()}`, { token: user.token })).status, 404);
});

test("invitations: create and preview code/link without creating a pair or exposing hashes", async () => {
  const owner = await server.createUser();
  const recipient = await server.createUser();
  const invitation = await server.createInvitation(owner);
  assert.deepEqual(Object.keys(invitation).sort(), ["code", "expiresAt", "invitationId", "inviteUrl", "qrContent"]);
  assert.match(invitation.code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
  const url = new URL(invitation.inviteUrl);
  assert.equal(url.origin, "https://invite.example.test");
  assert.equal(url.pathname, "/join");
  assert.match(url.searchParams.get("t"), /^[a-f0-9]{64}$/);
  assert.equal(invitation.qrContent, invitation.inviteUrl);
  assert.ok(Date.parse(invitation.expiresAt) > Date.now());
  const [stored] = server.sql(`SELECT code_hash,link_token_hash FROM pair_invitations WHERE invitation_id=${sqlString(invitation.invitationId)}`);
  assert.match(stored.code_hash, /^[a-f0-9]{64}$/);
  assert.match(stored.link_token_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.code_hash, invitation.code);
  assert.notEqual(stored.link_token_hash, url.searchParams.get("t"));
  for (const json of [{ code: ` ${invitation.code.toLowerCase()} ` }, linkInput(invitation)]) {
    const preview = await api("POST", "/pair-invitations/preview", { token: recipient.token, json });
    assert.equal(preview.status, 200);
    assert.deepEqual(preview.body.data, {
      invitationId: invitation.invitationId,
      inviter: { userId: owner.userId, displayName: owner.displayName },
      expiresAt: invitation.expiresAt,
    });
  }
  for (const endpoint of ["preview", "accept"]) {
    assert.equal((await api("POST", `/pair-invitations/${endpoint}`, {
      token: owner.token, json: { code: invitation.code },
    })).status, 400);
  }
  assert.equal((await server.currentPair(owner)).body.data, null);
  assert.equal((await server.currentPair(recipient)).body.data, null);
});

test("invitations: replacement invalidates both old credentials; revoke is owner-only and repeatable", async () => {
  const owner = await server.createUser();
  const recipient = await server.createUser();
  const first = await server.createInvitation(owner);
  const second = await server.createInvitation(owner);
  assert.notEqual(first.invitationId, second.invitationId);
  for (const json of [{ code: first.code }, linkInput(first)]) {
    for (const endpoint of ["preview", "accept"]) {
      assert.equal((await api("POST", `/pair-invitations/${endpoint}`, { token: recipient.token, json })).status, 409);
    }
  }
  assert.equal((await api("DELETE", `/pair-invitations/${second.invitationId}`, { token: recipient.token })).status, 404);
  for (let attempt = 0; attempt < 2; attempt++) {
    const revoked = await api("DELETE", `/pair-invitations/${second.invitationId}`, { token: owner.token });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data, null);
  }
  for (const json of [{ code: second.code }, linkInput(second)]) {
    assert.equal((await api("POST", "/pair-invitations/accept", { token: recipient.token, json })).status, 409);
  }
  assert.equal((await server.currentPair(owner)).body.data, null);
});

test("invitations: accept creates two memberships, invalidates other invites and returns the same pair on retry", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const outsider = await server.createUser();
  const bInvitation = await server.createInvitation(b);
  const invitation = await server.createInvitation(a);
  const first = await server.acceptCode(b, invitation);
  assert.equal(first.status, 201);
  const pairId = first.body.data.pairId;
  assert.equal(first.body.data.status, "active");
  for (const json of [{ code: invitation.code }, linkInput(invitation)]) {
    const retry = await api("POST", "/pair-invitations/accept", { token: b.token, json });
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.data, first.body.data);
  }
  for (const user of [a, b]) {
    assert.equal((await server.currentPair(user)).body.data.pairId, pairId);
    assert.equal((await api("POST", "/pair-invitations", { token: user.token })).status, 409);
  }
  assert.equal((await server.acceptCode(outsider, invitation)).status, 409);
  assert.equal((await api("POST", "/pair-invitations/preview", { token: outsider.token, json: { code: bInvitation.code } })).status, 409);
  assert.equal((await api("DELETE", `/pair-invitations/${invitation.invitationId}`, { token: a.token })).status, 409);
  const [count] = server.sql(`SELECT COUNT(*) AS total,COUNT(CASE WHEN left_at IS NULL THEN 1 END) AS active FROM pair_members WHERE pair_id=${sqlString(pairId)}`);
  assert.equal(count.total, 2);
  assert.equal(count.active, 2);
});

test("invitations: expiry is enforced by preview, accept and revoke without waiting 24 hours", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const invitation = await server.createInvitation(a);
  const now = Date.now();
  server.sql(`UPDATE pair_invitations SET created_at=${now - 10000},expires_at=${now - 1} WHERE invitation_id=${sqlString(invitation.invitationId)}`);
  for (const endpoint of ["preview", "accept"]) {
    for (const json of [{ code: invitation.code }, linkInput(invitation)]) {
      assert.equal((await api("POST", `/pair-invitations/${endpoint}`, { token: b.token, json })).status, 410);
    }
  }
  assert.equal((await api("DELETE", `/pair-invitations/${invitation.invitationId}`, { token: a.token })).status, 410);
  assert.equal((await server.currentPair(b)).body.data, null);
  await server.createInvitation(a);
});

test("invitations: inactive accounts cannot mutate invitations and inactive inviters cannot be accepted", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const invitation = await server.createInvitation(a);
  server.sql(`UPDATE users SET is_active=0 WHERE user_id=${sqlString(a.userId)}`);
  for (const [method, url, json] of [
    ["POST", "/pair-invitations", undefined],
    ["POST", "/pair-invitations/preview", { code: invitation.code }],
    ["POST", "/pair-invitations/accept", { code: invitation.code }],
    ["DELETE", `/pair-invitations/${invitation.invitationId}`, undefined],
  ]) {
    const options = { token: a.token };
    if (json) options.json = json;
    const blocked = await api(method, url, options);
    assert.equal(blocked.status, 401);
    assert.equal(blocked.body.error, "SESSION_REVOKED");
  }
  for (const endpoint of ["preview", "accept"]) {
    assert.equal((await api("POST", `/pair-invitations/${endpoint}`, { token: b.token, json: { code: invitation.code } })).status, 409);
  }
});

test("invitations: concurrent retries by the same recipient return one pair", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const invitation = await server.createInvitation(a);
  const send = () => api("POST", "/pair-invitations/accept", { token: b.token, json: linkInput(invitation) });
  const responses = await Promise.all([send(), send()]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.deepEqual(responses[0].body.data, responses[1].body.data);
});

test("invitations: two recipients racing for one code cannot create two pairs", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const c = await server.createUser();
  const invitation = await server.createInvitation(a);
  const responses = await Promise.all([server.acceptCode(b, invitation), server.acceptCode(c, invitation)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const winner = responses[0].status === 201 ? b : c;
  const loser = winner === b ? c : b;
  assert.equal((await server.currentPair(a)).body.data.pairId, (await server.currentPair(winner)).body.data.pairId);
  assert.equal((await server.currentPair(loser)).body.data, null);
  const [count] = server.sql(`SELECT COUNT(*) AS n FROM pairs WHERE created_by=${sqlString(a.userId)}`);
  assert.equal(count.n, 1);
});

test("invitations: one recipient accepting two invitations concurrently joins only one pair", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const c = await server.createUser();
  const first = await server.createInvitation(a);
  const second = await server.createInvitation(c);
  const responses = await Promise.all([server.acceptCode(b, first), server.acceptCode(b, second)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [201, 409]);
  const loser = responses[0].status === 201 ? c : a;
  assert.equal((await server.currentPair(loser)).body.data, null);
  const [count] = server.sql(`SELECT COUNT(*) AS n FROM pair_members WHERE user_id=${sqlString(b.userId)} AND left_at IS NULL`);
  assert.equal(count.n, 1);
});

test("invitations: revoke racing accept leaves either a revoked invite or one complete pair", async () => {
  const a = await server.createUser();
  const b = await server.createUser();
  const invitation = await server.createInvitation(a);
  const [revoked, accepted] = await Promise.all([
    api("DELETE", `/pair-invitations/${invitation.invitationId}`, { token: a.token }),
    server.acceptCode(b, invitation),
  ]);
  if (accepted.status === 201) {
    assert.equal(revoked.status, 409);
    assert.equal((await server.currentPair(a)).body.data.pairId, accepted.body.data.pairId);
    assert.equal((await server.currentPair(b)).body.data.members.length, 2);
  } else {
    assert.equal(accepted.status, 409);
    assert.equal(revoked.status, 200);
    assert.equal((await server.currentPair(a)).body.data, null);
    assert.equal((await server.currentPair(b)).body.data, null);
    const [count] = server.sql(`SELECT COUNT(*) AS n FROM pairs WHERE created_by=${sqlString(a.userId)}`);
    assert.equal(count.n, 0);
  }
});
