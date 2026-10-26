// swagger-jsdoc reads the route files from disk, which Workers cannot do at
// runtime, so `wrangler dev` / `wrangler deploy` write the document first.
const fs = require("fs");
const path = require("path");
const { specs } = require("../src/config/swagger");

const target = path.join(__dirname, "../build/openapi.json");
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify(specs));
console.log(`OpenAPI: ${target}`);
