const assert = require("node:assert/strict");
const { before, after, test } = require("node:test");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("node:crypto");
const { createTestServer, sqlString } = require("./helpers/testServer");

const server = createTestServer();
const { api } = server;
let origin;
before(async () => {
  await server.start();
  origin = server.origin;
}, { timeout: 90000 });
after(() => server.stop());

test("auth: public endpoints validate required input", async () => {
  for (const url of ["register", "login", "verify-email", "resend-verification", "refresh-token"]) {
    assert.equal((await api("POST", `/auth-service/${url}`, { json: {} })).status, 400, url);
  }
  assert.equal((await api("POST", "/auth-service/resend-verification", { json: { email: "invalid" } })).status, 400);
  assert.equal((await api("POST", "/auth-service/verify-email", { json: { email: "invalid", otp: "123456" } })).status, 400);
});

test("auth: expired OTP is rejected and resend succeeds after the cooldown", async () => {
  const user = await server.createUser({}, { verified: false });
  const [stored] = server.sql(`SELECT user_id FROM users WHERE email=${sqlString(user.email)}`);
  const past = new Date(Date.now() - 180000).toISOString();
  server.sql(`UPDATE otp_codes SET created_at=${sqlString(past)},expires_at=${sqlString(past)} WHERE user_id=${sqlString(stored.user_id)}`);
  const expired = await api("POST", "/auth-service/verify-email", { json: { email: user.email, otp: user.otp, deviceId: user.deviceId } });
  assert.equal(expired.status, 400);
  assert.match(expired.body.message, /expired/i);
  const resent = await api("POST", "/auth-service/resend-verification", { json: { email: user.email } });
  assert.equal(resent.status, 200);
  assert.match(resent.body.data.otp, /^\d{6}$/);
  assert.equal((await api("POST", "/auth-service/verify-email", { json: { email: user.email, otp: resent.body.data.otp, deviceId: user.deviceId } })).status, 200);
});

test("auth: register, verify email, login and refresh tokens", async () => {
  const account = {
    displayName: "  John & Doe  ", email: "John@Example.com",
    password: "password123", deviceId: randomUUID(),
  };
  const registered = await api("POST", "/auth-service/register", { json: account });
  assert.equal(registered.status, 201);
  assert.match(registered.body.data.otp, /^\d{6}$/);
  assert.equal(registered.body.data.emailMasked, "Joh*@Example.com");
  assert.equal((await api("POST", "/auth-service/register", { json: { email: "x" } })).status, 400);

  // Chưa xác thực: không đăng nhập được
  const inactive = await api("POST", "/auth-service/login", {
    json: { email: "john@example.com", password: "password123" },
  });
  assert.equal(inactive.status, 401);
  assert.equal(inactive.body.error, "Account Inactive");

  // Gửi lại ngay thì bị chặn
  const tooSoon = await api("POST", "/auth-service/resend-verification", {
    json: { email: "john@example.com" },
  });
  assert.equal(tooSoon.status, 429);

  const wrongOtp = await api("POST", "/auth-service/verify-email", {
    json: { email: "john@example.com", otp: registered.body.data.otp === "000000" ? "111111" : "000000", deviceId: account.deviceId },
  });
  assert.equal(wrongOtp.status, 400);
  assert.equal(wrongOtp.body.error, "Invalid OTP");

  const verified = await api("POST", "/auth-service/verify-email", {
    json: { email: "john@example.com", otp: registered.body.data.otp, deviceId: account.deviceId },
  });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.data.user.displayName, "John & Doe");
  assert.equal(Object.hasOwn(verified.body.data.user, "username"), false);
  assert.equal(new URL(verified.body.data.user.profilePic).searchParams.get("name"), "John & Doe");
  assert.ok(verified.body.data.tokens.accessToken);

  const again = await api("POST", "/auth-service/verify-email", {
    json: { email: "john@example.com", otp: registered.body.data.otp, deviceId: account.deviceId },
  });
  assert.equal(again.status, 400);
  assert.equal(again.body.error, "Already Verified");
  assert.equal((await api("POST", "/auth-service/resend-verification", {
    json: { email: "john@example.com" },
  })).status, 400);
  assert.equal((await api("POST", "/auth-service/resend-verification", {
    json: { email: "nobody@example.com" },
  })).status, 404);

  const duplicate = await api("POST", "/auth-service/register", {
    json: { ...account, email: "john@example.com" },
  });
  assert.equal(duplicate.status, 400);
  assert.equal(duplicate.body.message, "Email already in use");

  const wrong = await api("POST", "/auth-service/login", {
    json: { email: "john@example.com", password: "wrong-password" },
  });
  assert.equal(wrong.status, 401);

  const login = await api("POST", "/auth-service/login", {
    json: { email: "john@example.com", password: "password123", deviceId: account.deviceId, deviceCredential: verified.body.data.deviceCredential },
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.displayName, "John & Doe");
  assert.equal(login.body.data.tokens.tokenType, "Bearer");

  const refreshed = await api("POST", "/auth-service/refresh-token", {
    json: { refreshToken: login.body.data.tokens.refreshToken },
  });
  assert.equal(refreshed.status, 200);
  assert.ok(refreshed.body.data.accessToken);
  for (const token of [login.body.data.tokens.accessToken, login.body.data.tokens.refreshToken,
    refreshed.body.data.accessToken, refreshed.body.data.refreshToken]) {
    const payload = jwt.verify(token, "test-secret");
    assert.equal(Object.hasOwn(payload, "username"), false);
    assert.equal(payload.email, "John@Example.com");
  }
  assert.equal((await api("POST", "/auth-service/refresh-token", {
    json: { refreshToken: "invalid" },
  })).status, 401);

  const ghostToken = jwt.sign({ userId: "deleted-user", sessionId: "missing", tokenUse: "refresh" }, "test-secret", { expiresIn: "1h" });
  const ghost = await api("POST", "/auth-service/refresh-token", {
    json: { refreshToken: ghostToken },
  });
  assert.equal(ghost.status, 401);
  assert.equal(ghost.body.message, "User no longer exists");
});

test("auth: display name is required, supports Unicode and need not be unique", async () => {
  for (const displayName of [undefined, null, "", "   ", 123, {}, []]) {
    assert.equal((await api("POST", "/auth-service/register", {
      json: { email: "invalid-name@example.com", password: "password123", displayName },
    })).status, 400);
  }
  const displayName = "Nguyễn An & Bạn";
  for (let index = 0; index < 2; index++) {
    const user = await server.createUser({ displayName: `  ${displayName}  ` });
    const current = await api("GET", "/user-service/me", { token: user.token });
    assert.equal(current.body.data.userInfo.displayName, displayName);
    assert.equal(new URL(current.body.data.userInfo.profilePic).searchParams.get("name"), displayName);
  }
});

test("auth: OTP attempt limit and re-registering an unverified email", async () => {
  const account = {
    displayName: "Jane Doe", email: "jane@example.com",
    password: "password123", deviceId: randomUUID(),
  };
  const first = await api("POST", "/auth-service/register", { json: account });
  assert.equal(first.status, 201);
  const { otp } = first.body.data;
  const wrongOtp = otp === "000000" ? "111111" : "000000";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await api("POST", "/auth-service/verify-email", {
      json: { email: account.email, otp: wrongOtp, deviceId: account.deviceId },
    });
    assert.equal(result.body.message, "Invalid OTP. Please try again.");
  }
  const locked = await api("POST", "/auth-service/verify-email", {
    json: { email: account.email, otp, deviceId: account.deviceId },
  });
  assert.equal(locked.status, 400);
  assert.equal(locked.body.message, "Too many failed attempts. Please request a new one.");

  // Email chưa xác thực: đăng ký lại thay bản cũ, mã mới dùng được, mật khẩu mới có hiệu lực
  const second = await api("POST", "/auth-service/register", {
    json: { ...account, password: "new-password" },
  });
  assert.equal(second.status, 201);
  const verifiedAgain = await api("POST", "/auth-service/verify-email", {
    json: { email: account.email, otp: second.body.data.otp, deviceId: account.deviceId },
  });
  assert.equal(verifiedAgain.status, 200);
  assert.equal((await api("POST", "/auth-service/login", {
    json: { email: account.email, password: "new-password", deviceId: account.deviceId, deviceCredential: verifiedAgain.body.data.deviceCredential },
  })).status, 200);
});

