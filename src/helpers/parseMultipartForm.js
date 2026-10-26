/**
 * Parses a multipart/form-data request. app.js keeps multipart bodies as a raw
 * Buffer (express.raw), which the Web standard FormData parser reads in both
 * Workers and Node, so no busboy is needed.
 * @param {Object} req - Express request object (req.body is a Buffer).
 * @return {Promise<Object>} - Resolves to { files, fields }. Each file has
 *   filename, mimetype and buffer.
 */
const parseMultipartForm = async (req) => {
  if (!Buffer.isBuffer(req.body)) {
    throw new Error("Invalid multipart form data");
  }

  let form;
  try {
    form = await new Response(req.body, {
      headers: { "content-type": req.headers["content-type"] },
    }).formData();
  } catch (error) {
    throw new Error("Invalid multipart form data");
  }

  const files = {};
  const fields = {};
  for (const [name, value] of form.entries()) {
    if (typeof value === "string") {
      fields[name] = value;
    } else {
      files[name] = {
        filename: value.name,
        mimetype: value.type || "application/octet-stream",
        buffer: Buffer.from(await value.arrayBuffer()),
      };
    }
  }

  return { files, fields };
};

module.exports = {
  parseMultipartForm,
};
