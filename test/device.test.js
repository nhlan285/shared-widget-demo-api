const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { before, after, test } = require('node:test');
const { createTestServer, sqlString, JWT_SECRET } = require('./helpers/testServer');

const server = createTestServer();
const { api } = server;
before(() => server.start(), { timeout: 90000 });
after(() => server.stop());

const login = (user, deviceId = user.deviceId, deviceCredential = user.deviceCredential) =>
  api('POST', '/auth-service/login', { json: {
    email: user.email, password: user.password, deviceId, deviceCredential,
  } });
const verify = (data, otp = data.otp) => api('POST', '/auth-service/verify-device-login', {
  json: { challengeId: data.challengeId, otp },
});
const me = (token) => api('GET', '/user-service/me', { token });
const wrongOTP = (otp) => otp === '000000' ? '111111' : '000000';
const cooldown = (userId) => server.sql(`UPDATE device_login_challenges
  SET last_sent_at=${Date.now() - 61000} WHERE user_id=${sqlString(userId)}`);

test('devices: current API authenticates, validates push input and never exposes secrets', async () => {
  for (const method of ['GET', 'PUT', 'DELETE']) {
    assert.equal((await api(method, '/devices/current')).status, 401);
    assert.equal((await api(method, '/devices/current', { token: 'bad' })).status, 403);
  }
  const user = await server.createUser();
  const initial = await api('GET', '/devices/current', { token: user.token });
  assert.equal(initial.status, 200);
  assert.equal(initial.body.data.deviceId, user.deviceId);
  assert.equal(initial.body.data.pushRegistered, false);
  for (const body of [{}, { fcmToken: '' }, { fcmToken: 'bad token' },
    { fcmToken: 'x'.repeat(4097) }, { fcmToken: 'ok', deviceId: randomUUID() }]) {
    assert.equal((await api('PUT', '/devices/current', { token: user.token, json: body })).status, 400);
  }
  const pushed = await api('PUT', '/devices/current', {
    token: user.token, json: { fcmToken: `push-${randomUUID()}` },
  });
  assert.equal(pushed.status, 200);
  assert.equal(pushed.body.data.pushRegistered, true);
  for (const field of ['credentialHash', 'credential_hash', 'fcmToken', 'fcm_token', 'deviceCredential']) {
    assert.equal(Object.hasOwn(pushed.body.data, field), false);
  }
  assert.equal((await api('DELETE', '/devices/current', { token: user.token, json: { deviceId: user.deviceId } })).status, 400);
  for (let i = 0; i < 2; i++) {
    const removed = await api('DELETE', '/devices/current', { token: user.token });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data, null);
  }
  assert.equal((await api('GET', '/devices/current', { token: user.token })).body.data.pushRegistered, false);
  assert.equal((await me(user.token)).status, 200);
});

test('sessions: new device OTP preserves old session, then atomically switches and retains history', async () => {
  const user = await server.createUser();
  await api('PUT', '/devices/current', { token: user.token, json: { fcmToken: `push-${randomUUID()}` } });
  const deviceB = randomUUID();
  const pending = await login(user, deviceB, undefined);
  assert.equal(pending.status, 200);
  const challenge = pending.body.data;
  assert.equal(challenge.isOTP, true);
  assert.equal(challenge.tokens, undefined);
  assert.equal((await me(user.token)).status, 200);
  assert.equal((await verify(challenge, wrongOTP(challenge.otp))).status, 400);
  assert.equal((await me(user.token)).status, 200);
  const accepted = await verify(challenge);
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.data.isOTP, false);
  assert.match(accepted.body.data.deviceCredential, /^[0-9a-f]{64}$/);
  const tokenB = accepted.body.data.tokens.accessToken;
  assert.equal((await me(tokenB)).status, 200);
  const revoked = await me(user.token);
  assert.equal(revoked.status, 401);
  assert.equal(revoked.body.error, 'SESSION_REVOKED');
  assert.equal((await api('POST', '/auth-service/refresh-token', { json: { refreshToken: user.refreshToken } })).status, 401);
  assert.equal((await api('PUT', '/devices/current', { token: user.token, json: { fcmToken: 'stale-push' } })).status, 401);
  const current = await api('GET', '/devices/current', { token: tokenB });
  assert.equal(current.body.data.deviceId, deviceB);
  assert.equal(current.body.data.pushRegistered, false);
  assert.equal((await verify(challenge)).status, 400);
  const [counts] = server.sql(`SELECT
    (SELECT COUNT(*) FROM user_sessions WHERE user_id=${sqlString(user.userId)}) sessions,
    (SELECT COUNT(*) FROM user_devices WHERE user_id=${sqlString(user.userId)}) devices,
    (SELECT COUNT(*) FROM user_devices WHERE user_id=${sqlString(user.userId)} AND fcm_token IS NOT NULL) push`);
  assert.deepEqual(counts, { sessions: 1, devices: 2, push: 0 });
  // Previously trusted A can replace B with password + its original credential.
  const back = await login(user);
  assert.equal(back.body.data.isOTP, false);
  assert.equal((await me(tokenB)).status, 401);
  const tokenA = back.body.data.tokens.accessToken;
  assert.equal((await api('POST', '/auth-service/logout', { token: tokenB })).status, 401);
  assert.equal((await me(tokenA)).status, 200);
});

test('sessions: logout clears current session and FCM but trusted device logs in without OTP', async () => {
  const user = await server.createUser();
  await api('PUT', '/devices/current', { token: user.token, json: { fcmToken: `push-${randomUUID()}` } });
  assert.equal((await api('POST', '/auth-service/logout', { token: user.token })).status, 200);
  assert.equal((await me(user.token)).status, 401);
  const [state] = server.sql(`SELECT
    (SELECT COUNT(*) FROM user_sessions WHERE user_id=${sqlString(user.userId)}) sessions,
    (SELECT COUNT(*) FROM user_devices WHERE user_id=${sqlString(user.userId)}) devices,
    (SELECT COUNT(*) FROM user_devices WHERE user_id=${sqlString(user.userId)} AND fcm_token IS NOT NULL) push`);
  assert.deepEqual(state, { sessions: 0, devices: 1, push: 0 });
  const signedIn = await login(user);
  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.data.isOTP, false);
  assert.equal(signedIn.body.data.deviceCredential, user.deviceCredential);
});

test('sessions: copying deviceId without its credential does not bypass OTP', async () => {
  const user = await server.createUser();
  const pending = await api('POST', '/auth-service/login', { json: {
    email: user.email, password: user.password, deviceId: user.deviceId,
  } });
  assert.equal(pending.body.data.isOTP, true);
  assert.equal(pending.body.data.tokens, undefined);
  assert.equal((await me(user.token)).status, 200);
  assert.equal((await api('POST', '/auth-service/login', { json: {
    email: user.email, password: 'wrong-password', deviceId: randomUUID(),
  } })).status, 401);
  assert.equal((await api('POST', '/auth-service/login', { json: {
    email: user.email, password: user.password,
  } })).status, 400);
});

test('sessions: refresh tokens are rotated once, token uses and legacy JWTs are rejected', async () => {
  const user = await server.createUser();
  assert.equal((await me(user.refreshToken)).status, 403);
  assert.equal((await me(jwt.sign({ userId: user.userId }, JWT_SECRET, { expiresIn: '1h' }))).status, 403);
  assert.equal((await api('POST', '/auth-service/refresh-token', { json: { refreshToken: user.token } })).status, 401);
  const refreshes = await Promise.all([1, 2].map(() => api('POST', '/auth-service/refresh-token', {
    json: { refreshToken: user.refreshToken },
  })));
  assert.deepEqual(refreshes.map((r) => r.status).sort(), [200, 401]);
  const tokens = refreshes.find((r) => r.status === 200).body.data;
  assert.equal((await me(tokens.accessToken)).status, 200);
  assert.equal((await api('POST', '/auth-service/refresh-token', { json: { refreshToken: user.refreshToken } })).status, 401);
  server.sql(`UPDATE user_sessions SET expires_at=created_at+1 WHERE user_id=${sqlString(user.userId)}`);
  assert.equal((await me(tokens.accessToken)).status, 401);
});

test('device OTP: cooldown, expiry, resend invalidates old code and attempt limit preserves old session', async () => {
  const user = await server.createUser();
  const pending = (await login(user, randomUUID(), undefined)).body.data;
  assert.equal((await api('POST', '/auth-service/resend-device-login-otp', { json: { challengeId: pending.challengeId } })).status, 429);
  assert.equal((await login(user, randomUUID(), undefined)).status, 429);
  server.sql(`UPDATE device_login_challenges SET expires_at=${Date.now() - 1},last_sent_at=${Date.now() - 61000}
    WHERE challenge_id=${sqlString(pending.challengeId)}`);
  assert.equal((await verify(pending)).status, 400);
  const resent = await api('POST', '/auth-service/resend-device-login-otp', { json: { challengeId: pending.challengeId } });
  assert.equal(resent.status, 200);
  assert.equal(resent.body.data.challengeId, pending.challengeId);
  assert.equal((await verify(pending)).status, 400);
  const next = resent.body.data;
  for (let i = 0; i < 4; i++) await verify(next, wrongOTP(next.otp));
  assert.equal((await verify(next)).status, 400);
  assert.equal((await me(user.token)).status, 200);
});

test('device OTP: simultaneous verification consumes once and leaves exactly one session', async () => {
  const user = await server.createUser();
  const challenge = (await login(user, randomUUID(), undefined)).body.data;
  const results = await Promise.all([verify(challenge), verify(challenge)]);
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert(results.every((r) => [200, 400, 409].includes(r.status)));
  assert.equal((await me(results.find((r) => r.status === 200).body.data.tokens.accessToken)).status, 200);
  assert.equal((await me(user.token)).status, 401);
});

test('device OTP: a newer challenge supersedes the old one; changed session cannot be replaced', async () => {
  const user = await server.createUser();
  const first = (await login(user, randomUUID(), undefined)).body.data;
  cooldown(user.userId);
  const second = (await login(user, randomUUID(), undefined)).body.data;
  assert.equal((await verify(first)).status, 400);
  const renewed = await login(user);
  assert.equal(renewed.body.data.isOTP, false);
  assert([400, 409].includes((await verify(second)).status));
  assert.equal((await me(renewed.body.data.tokens.accessToken)).status, 200);
});

test('device OTP: account send limit cannot be bypassed by requesting another challenge', async () => {
  const user = await server.createUser();
  const challenge = (await login(user, randomUUID(), undefined)).body.data;
  server.sql(`UPDATE device_login_challenges SET send_count=5,last_sent_at=${Date.now() - 61000}
    WHERE challenge_id=${sqlString(challenge.challengeId)}`);
  assert.equal((await login(user, randomUUID(), undefined)).status, 429);
  assert.equal((await api('POST', '/auth-service/resend-device-login-otp', { json: { challengeId: challenge.challengeId } })).status, 429);
  assert.equal((await me(user.token)).status, 200);
});

test('registration: simultaneous email verification cannot create two valid sessions', async () => {
  const user = await server.createUser({}, { verified: false });
  const results = await Promise.all([1, 2].map(() => api('POST', '/auth-service/verify-email', {
    json: { email: user.email, otp: user.otp, deviceId: randomUUID() },
  })));
  assert.equal(results.filter((r) => r.status === 200).length, 1);
  assert(results.every((r) => [200, 400, 409].includes(r.status)));
  assert.equal((await me(results.find((r) => r.status === 200).body.data.tokens.accessToken)).status, 200);
});
