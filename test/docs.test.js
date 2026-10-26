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

test("docs: Swagger describes every registered API and all pair response schemas", async () => {
  const response = await fetch(`${origin}/api-docs.json`);
  assert.equal(response.status, 200);
  const specs = await response.json();
  const registered = [];
  // Read the actual route registration so newly added undocumented APIs fail this test.
  require("../src/routes")({ use(prefix, router) {
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const url = prefix.replace(/^\/v1/, "") + (layer.route.path === "/" ? "" : layer.route.path);
      const swaggerPath = url.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      for (const method of Object.keys(layer.route.methods)) registered.push([method, swaggerPath]);
    }
  } });
  assert.equal(registered.length, Object.keys(specs.paths)
    .filter((path) => path !== "/postcards/realtime")
    .reduce((sum, path) => sum + Object.keys(specs.paths[path])
      .filter((method) => ["get","post","put","patch","delete"].includes(method)).length, 0));
  const resolve = (value) => {
    if (!value.$ref) return value;
    assert(value.$ref.startsWith("#/"));
    const resolved = value.$ref.slice(2).split("/").reduce((node, key) => node?.[key], specs);
    assert(resolved, value.$ref);
    return resolved;
  };
  for (const [method, url] of registered) {
    const operation = specs.paths[url]?.[method];
    assert(operation, `${method.toUpperCase()} ${url} is undocumented`);
    if (!url.startsWith("/pair")) continue;
    assert.deepEqual(operation.security, [{ bearerAuth: [] }]);
    for (const [status, definition] of Object.entries(operation.responses)) {
      const schema = resolve(definition).content?.["application/json"]?.schema;
      assert(schema, `${method} ${url}: ${status} missing response schema`);
      resolve(schema);
    }
  }
  for (const url of ["/pair-invitations/preview", "/pair-invitations/accept"]) {
    const schema = resolve(specs.paths[url].post.requestBody.content["application/json"].schema);
    assert.equal(schema.oneOf.length, 2);
    assert(schema.oneOf.every((branch) => branch.additionalProperties === false));
  }
  assert(specs.paths["/postcards/realtime"].get.responses[101]);
  assert.deepEqual(specs.paths["/postcards/{id}/send"].post.requestBody
    .content["multipart/form-data"].schema.required, ["file", "revision", "lockId"]);
  assert(specs.paths["/postcards/{id}/image"].get.responses[200].content["image/png"]);
});

test("docs: root, OpenAPI export, Postman export and CORS are reachable", async () => {
  const root = await fetch(`${origin}/`);
  assert.equal(root.status, 200);
  assert.equal((await root.json()).documentation.swagger, "/api-docs");
  const exported = await fetch(`${origin}/openapi.json`);
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("content-disposition"), /attachment/);
  assert((await exported.json()).paths["/pair-invitations/accept"]);
  const postman = await fetch(`${origin}/postman-collection`);
  assert.equal(postman.status, 200);
  assert.equal((await postman.json()).variable.find((entry) => entry.key === "baseUrl").value, origin);
  const cors = await fetch(`${origin}/v1/pairs/current`, {
    method: "OPTIONS", headers: { Origin: "https://client.example.test", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization" },
  });
  assert.equal(cors.status, 200);
  assert.equal(cors.headers.get("access-control-allow-origin"), "*");
});

test("docs and file range requests", async () => {
  const docs = await fetch(`${origin}/api-docs`);
  assert.equal(docs.status, 200);
  assert.match(await docs.text(), /swagger-ui-bundle\.js/);
  const specs = await (await fetch(`${origin}/api-docs.json`)).json();
  assert.equal(specs.servers[0].url, "/v1");
  assert.ok(specs.paths["/scan-service/scans"]);

  const { token } = await server.createUser();
  const scan = (await api("POST", "/scan-service/scans", {
    token, form: imageForm({ label: "Acne", confidence: "0.9" }),
  })).body.data;
  const partial = await fetch(scan.imageUrl, { headers: { Range: "bytes=1-2" } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get("content-range"), "bytes 1-2/4");
  assert.equal((await fetch(`${origin}/files/missing.png`)).status, 404);
  const file = await fetch(scan.imageUrl);
  const etag = file.headers.get("etag");
  await file.arrayBuffer();
  const cached = await fetch(scan.imageUrl, { headers: { "If-None-Match": etag } });
  assert.equal(cached.status, 304);
  const head = await fetch(scan.imageUrl, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), "4");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(scan.imageUrl, { method: "POST" })).status, 405);
});
