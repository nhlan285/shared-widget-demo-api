// Cloudflare Workers entry: Express API on D1, uploaded files served from R2.
import { createServer } from "node:http";
import { httpServerHandler } from "cloudflare:node";

import { setBindings } from "./src/config/cloudflare.js";
import { FILES_PREFIX } from "./src/config/storage.js";
import { createApp } from "./src/app.js";
import { serveFile } from "./src/helpers/serveFile.js";
import specs from "./build/openapi.json";
import postcardService from "./src/services/postcardService.js";
import postcardCleanup from "./src/services/postcardCleanup.js";
export { PostcardRoom } from "./src/realtime/PostcardRoom.mjs";

const PORT = 8080;
const SWAGGER_UI = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14";

// swagger-ui-express serves its assets from node_modules on disk, which a
// Worker does not have, so the docs page loads Swagger UI from a CDN.
const docsHtml = `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Shared Widget API Documentation</title>
  <link rel="stylesheet" href="${SWAGGER_UI}/swagger-ui.css">
  <style>.swagger-ui .topbar { display: none }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="${SWAGGER_UI}/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: "/api-docs.json",
      dom_id: "#swagger-ui",
      persistAuthorization: true,
      filter: true,
      docExpansion: "list",
      defaultModelRendering: "schema",
      tryItOutEnabled: true,
    });
  </script>
</body>
</html>`;

const app = createApp({
  specs,
  docsPage: (req, res) => res.type("html").send(docsHtml),
});
createServer(app).listen(PORT);
const api = httpServerHandler({ port: PORT });

export default {
  async fetch(request, env, ctx) {
    setBindings(env);

    const url = new URL(request.url);
    if (url.pathname === "/v1/postcards/realtime") {
      try {
        const ticket = postcardService.verifyTicket(env, url.searchParams.get("ticket"));
        const target = new URL("https://postcard.internal/connect");
        target.searchParams.set("ticket", url.searchParams.get("ticket"));
        return await postcardService.room(env, ticket.pairId).fetch(new Request(target, {
          method: request.method, headers: request.headers,
        }));
      } catch (error) {
        return Response.json({ statusCode: error.statusCode || 500, error: "Realtime Connection Failed",
          message: error.statusCode ? error.message : "Could not connect to realtime",
          timestamp: new Date().toISOString() }, { status: error.statusCode || 500,
          headers: { "cache-control": "no-store" } });
      }
    }
    if (url.pathname.startsWith(FILES_PREFIX)) {
      // TEMP: the personal deployment has its R2 binding commented out.
      if (!env.FILES) {
        return new Response("Image storage is temporarily disabled", { status: 503 });
      }
      let key;
      try { key = decodeURIComponent(url.pathname.slice(FILES_PREFIX.length)); }
      catch { return new Response("Invalid path", { status:400 }); }
      // All creation media stays private, including encoded slash variants.
      if (key === "postcards" || key.startsWith("postcards/")) {
        return new Response("Not Found", {status:404,headers:{"cache-control":"no-store"}});
      }
      return serveFile(request, env.FILES, key);
    }

    // The Node HTTP shim does not expose the public scheme/host to Express;
    // sendSuccessResponse uses them to build absolute file URLs.
    const headers = new Headers(request.headers);
    headers.set("x-forwarded-proto", url.protocol.slice(0, -1));
    headers.set("x-forwarded-host", url.host);
    return api.fetch(new Request(request, { headers }), env, ctx);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([
      postcardCleanup.cleanupPostcardImages(env),
      postcardCleanup.cleanupPostcardRooms(env),
    ]));
  },
};
