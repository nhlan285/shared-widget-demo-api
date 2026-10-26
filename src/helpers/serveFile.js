// Serves /files/<key> from the R2 bucket, with HTTP Range and conditional GET.
const CONTENT_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const contentTypeFor = (key) => {
  const dot = key.lastIndexOf(".");
  return CONTENT_TYPES[dot === -1 ? "" : key.slice(dot).toLowerCase()] || "application/octet-stream";
};

const rangeOf = (range, size) => {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return { offset, length: range.length ?? size - offset };
};

const serveFile = async (request, bucket, key) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  if (!key) return new Response("Not Found", { status: 404 });

  const wantsRange = request.method === "GET" && request.headers.has("range");
  let object;
  try {
    object = request.method === "HEAD"
      ? await bucket.head(key)
      : await bucket.get(key, {
        onlyIf: request.headers,
        ...(wantsRange ? { range: request.headers } : {}),
      });
  } catch {
    // R2 rejects ranges that start past the end of the object.
    return new Response("Range Not Satisfiable", { status: 416 });
  }
  if (!object) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", contentTypeFor(key));
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("access-control-allow-origin", "*");
  headers.set("cache-control", "public, max-age=86400");

  if (request.method === "HEAD") {
    headers.set("content-length", String(object.size));
    return new Response(null, { headers });
  }
  if (!("body" in object)) {
    // A conditional header (If-None-Match, If-Modified-Since...) did not match.
    return new Response(null, { status: request.headers.has("if-none-match") ? 304 : 412, headers });
  }
  if (wantsRange && object.range) {
    const { offset, length } = rangeOf(object.range, object.size);
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(object.body, { headers });
};

module.exports = { serveFile, contentTypeFor };
