const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const jwt = require("jsonwebtoken");

const ROOT = path.resolve(__dirname, "../..");
const WRANGLER = path.join(ROOT, "node_modules/wrangler/bin/wrangler.js");
const JWT_SECRET = "test-secret";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;

const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const imageForm = (fields, name = "photo.png", bytes = [0x89, 0x50, 0x4e, 0x47]) => {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(bytes)], { type: "image/png" }), name);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return form;
};

function createTestServer({ withoutR2 = false } = {}) {
  let state;
  let config;
  let tempRoot;
  let worker;
  let closed;
  let workerError;
  let output = "";
  let origin;

  const cli = (args) => {
    try {
      return execFileSync(process.execPath, [WRANGLER, ...args, "--config", config], {
        cwd: ROOT,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(state, "wrangler.log") },
        stdio: "pipe",
      });
    } catch (error) {
      throw new Error(`Test Wrangler command failed:\n${error.stdout || ""}\n${error.stderr || error.message}`);
    }
  };

  const start = async () => {
    tempRoot = fs.realpathSync(os.tmpdir());
    state = fs.mkdtempSync(path.join(tempRoot, "shared-widget-test-"));
    config = path.join(state, "wrangler.json");
    // A separate config avoids loading personal .dev.vars or sending real mail.
    fs.writeFileSync(config, JSON.stringify({
      name: "shared-widget-be-test",
      main: path.join(ROOT, "worker.mjs"),
      compatibility_date: "2025-09-15",
      compatibility_flags: ["nodejs_compat"],
      d1_databases: [{
        binding: "DB", database_name: "shared-widget-test",
        database_id: "00000000-0000-0000-0000-000000000001",
        migrations_dir: path.join(ROOT, "migrations"),
      }],
      r2_buckets: withoutR2 ? [] : [{ binding: "FILES", bucket_name: "shared-widget-test-files" }],
      durable_objects: { bindings: [{ name: "POSTCARD_ROOMS", class_name: "PostcardRoom" }] },
      migrations: [{ tag: "postcards-v1", new_sqlite_classes: ["PostcardRoom"] }],
      vars: {
        JWT_SECRET, NODE_ENV: "development",
        INVITATION_HMAC_SECRET: "test-invitation-secret",
        APP_LINK_BASE_URL: "https://invite.example.test",
        EMAIL_USER: "", EMAIL_PASS: "",
      },
    }));
    execFileSync(process.execPath, [path.join(ROOT, "scripts/build-openapi.js")], {
      cwd: ROOT, stdio: "pipe", windowsHide: true,
    });
    cli(["d1", "migrations", "apply", "DB", "--local", "--persist-to", state]);
    const port = await freePort();
    origin = `http://127.0.0.1:${port}`;
    worker = spawn(process.execPath, [
      WRANGLER, "dev", "--config", config,
      "--port", String(port), "--ip", "127.0.0.1", "--persist-to", state,
      "--show-interactive-dev-session=false", "--test-scheduled",
    ], {
      cwd: ROOT, stdio: "pipe", windowsHide: true,
      env: { ...process.env, WRANGLER_SEND_METRICS: "false", WRANGLER_LOG_PATH: path.join(state, "wrangler.log") },
    });
    closed = new Promise((resolve) => {
      worker.once("close", resolve);
      worker.once("error", (error) => { workerError = error; resolve(); });
    });
    worker.stdout.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
    worker.stderr.on("data", (chunk) => { output = (output + chunk).slice(-16000); });
    for (let attempt = 0; attempt < 120; attempt++) {
      if (workerError || worker.exitCode !== null || worker.signalCode !== null) break;
      try {
        const response = await fetch(`${origin}/`, {
          headers: { Connection: "close" }, signal: AbortSignal.timeout(1000),
        });
        if (response.ok) return;
      } catch { /* Wait for the local runtime to listen. */ }
      await delay(250);
    }
    throw new Error(`Test Worker failed to start: ${workerError?.message || ""}\n${output}`);
  };

  const stop = async () => {
    if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/PID", String(worker.pid), "/T", "/F"], {
            stdio: "ignore", windowsHide: true, timeout: 10000,
          });
        } catch (error) {
          await delay(100);
          if (worker.exitCode === null && worker.signalCode === null) throw error;
        }
      } else {
        worker.kill("SIGTERM");
      }
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Test Worker did not stop")), 15000); }),
        ]);
      } finally { clearTimeout(timer); }
    }
    if (state) {
      // Never recursively remove anything outside the temp directory we created.
      const resolved = fs.realpathSync(state);
      const relative = path.relative(tempRoot, resolved);
      assert(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
      assert(path.basename(resolved).startsWith("shared-widget-test-"));
      await fs.promises.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  };

  const api = async (method, url, options = {}) => {
    // Synchronous Wrangler fixture commands can block this process past the
    // Worker's keep-alive timeout. Do not reuse stale sockets after those calls.
    const headers = { Connection: "close", ...(options.headers || {}) };
    if (options.token) headers.Authorization = `Bearer ${options.token}`;
    let body;
    if (Object.prototype.hasOwnProperty.call(options, "json")) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options.form) body = options.form;
    let response;
    try {
      response = await fetch(`${origin}/v1${url}`, {
        method, headers, body, signal: AbortSignal.timeout(15000),
      });
    } catch (error) {
      const reason = error.cause?.code || error.name;
      throw new Error(`${method} ${url}: ${error.message} (${reason})`, { cause: error });
    }
    const payload = await response.json();
    assert.equal(payload.statusCode, response.status, `${method} ${url}: status envelope`);
    assert.equal(typeof payload.message, "string");
    assert.ok(Number.isFinite(Date.parse(payload.timestamp)), `${method} ${url}: timestamp`);
    if (response.ok) assert.ok(Object.hasOwn(payload, "data"));
    else assert.equal(typeof payload.error, "string");
    return { status: response.status, body: payload, headers: response.headers };
  };

  const createUser = async (overrides = {}, { verified = true } = {}) => {
    const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
    const account = {
      displayName: `Test ${suffix}`, email: `test_${suffix}@example.com`,
      password: "test-password-123", deviceId: randomUUID(), ...overrides,
    };
    const registered = await api("POST", "/auth-service/register", { json: account });
    assert.equal(registered.status, 201);
    assert.match(registered.body.data.otp, /^\d{6}$/);
    if (!verified) return { ...account, otp: registered.body.data.otp };
    const result = await api("POST", "/auth-service/verify-email", {
      json: { email: account.email, otp: registered.body.data.otp, deviceId: account.deviceId },
    });
    assert.equal(result.status, 200);
    return { ...account, userId: result.body.data.user.userId, token: result.body.data.tokens.accessToken, refreshToken: result.body.data.tokens.refreshToken, deviceCredential: result.body.data.deviceCredential };
  };

  const createInvitation = async (user) => {
    const response = await api("POST", "/pair-invitations", { token: user.token });
    assert.equal(response.status, 201);
    return response.body.data;
  };
  const currentPair = (user) => api("GET", "/pairs/current", { token: user.token });
  const acceptCode = (user, invitation) => api("POST", "/pair-invitations/accept", {
    token: user.token, json: { code: invitation.code },
  });
  const connect = async () => {
    const a = await createUser();
    const b = await createUser();
    const invitation = await createInvitation(a);
    const accepted = await acceptCode(b, invitation);
    assert.equal(accepted.status, 201);
    return { a, b, invitation, pairId: accepted.body.data.pairId };
  };
  // Fixture/inspection only: always uses this suite's temporary D1, never --remote.
  const sql = (command) => JSON.parse(cli([
    "d1", "execute", "DB", "--local", "--persist-to", state, "--command", command, "--json",
  ])).flatMap((result) => result.results || []);

  return { start, stop, api, createUser, createInvitation, currentPair, acceptCode, connect, sql,
    get origin() { return origin; },
  };
}

const linkInput = (invitation) => ({ linkToken: new URL(invitation.inviteUrl).searchParams.get("t") });
module.exports = { createTestServer, imageForm, sqlString, linkInput, JWT_SECRET };
