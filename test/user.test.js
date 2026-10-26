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

test("user: profile update requires authentication and rejects unsupported-only input", async () => {
  assert.equal((await api("PUT", "/user-service/me", { json: {} })).status, 401);
  assert.equal((await api("PUT", "/user-service/me", { token: "bad", json: {} })).status, 403);
  const user = await server.createUser();
  assert.equal((await api("PUT", "/user-service/me", { token: user.token, json: { role: "admin" } })).status, 400);
  const current = await api("GET", "/user-service/me", { token: user.token });
  assert.equal(current.body.data.userInfo.role, "user");
});

test("user: read and update profile, upload avatar to R2", async () => {
  const { token } = await server.createUser({
    displayName: "John Doe", email: "John@Example.com",
    password: "password123",
  });
  assert.equal((await api("GET", "/user-service/me")).status, 401);
  assert.equal((await api("GET", "/user-service/me", { token: "bad" })).status, 403);

  const me = await api("GET", "/user-service/me", { token });
  assert.equal(me.body.data.userInfo.email, "John@Example.com");
  assert.equal(me.body.data.userInfo.isActive, true);
  assert.equal(me.body.data.userInfo.password, undefined);
  assert.ok(me.body.data.userInfo.lastLogin);

  const updated = await api("PUT", "/user-service/me", {
    token, json: { displayName: "  Updated Name  ", role: "admin" },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.userInfo.displayName, "Updated Name");
  assert.equal(updated.body.data.userInfo.role, "user");
  assert.equal((await api("PUT", "/user-service/me", { token, json: { gender: 7 } })).status, 400);

  const avatar = await api("PUT", "/user-service/me", {
    token, form: imageForm({ displayName: "John D" }, "ảnh đại diện.png"),
  });
  assert.equal(avatar.status, 200);
  const firstPic = avatar.body.data.data.profilePic;
  assert.ok(firstPic.startsWith(`${origin}/files/profile_pictures/`));
  const file = await fetch(firstPic);
  assert.equal(file.status, 200);
  assert.equal(file.headers.get("content-type"), "image/png");
  assert.equal((await file.arrayBuffer()).byteLength, 4);

  const replaced = await api("PUT", "/user-service/me", {
    token, form: imageForm({ displayName: "John D" }),
  });
  assert.notEqual(replaced.body.data.data.profilePic, firstPic);
  assert.equal((await fetch(firstPic)).status, 404);

  const avatarOnly = await api("PUT", "/user-service/me", { token, form: imageForm({}) });
  assert.equal(avatarOnly.status, 200);
  assert.equal(avatarOnly.body.data.data.displayName, "John D");
});

test("user: display name validation applies to JSON and avatar uploads", async () => {
  const user = await server.createUser();
  for (const displayName of ["", "   ", null, 123, {}, []]) {
    assert.equal((await api("PUT", "/user-service/me", {
      token: user.token, json: { displayName },
    })).status, 400);
  }
  assert.equal((await api("PUT", "/user-service/me", {
    token: user.token, form: imageForm({ displayName: "   " }),
  })).status, 400);
  const current = await api("GET", "/user-service/me", { token: user.token });
  assert.equal(current.body.data.userInfo.displayName, user.displayName);
  for (const field of ["username", "firstName", "lastName", "gender", "birthday", "phone", "description"]) {
    assert.equal(Object.hasOwn(current.body.data.userInfo, field), false, field);
    assert.equal((await api("PUT", "/user-service/me", {
      token: user.token, json: { [field]: "unused" },
    })).status, 400, field);
  }
});

