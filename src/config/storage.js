// Files live in Cloudflare R2 and are served by the Worker at /files/<key>.
// The database stores the relative URL; sendSuccessResponse makes it absolute.
const { bucket, optionalBinding } = require("./cloudflare");

// The temporary deployment omits FILES so it does not require R2 billing.
const imageStorageEnabled = () => Boolean(optionalBinding("FILES"));

const FILES_PREFIX = "/files/";
const R2_DELETE_BATCH = 1000;

/**
 * Chuẩn hoá tên file để dùng trong key R2
 * @param {string} name - Tên file gốc
 * @param {string} fallback - Tên mặc định
 * @return {string}
 */
const safeFileName = (name, fallback = "file") =>
  String(name || fallback).replace(/[^A-Za-z0-9._-]/g, "_").slice(-100) || fallback;

/**
 * Upload buffer lên R2
 * @param {string} key - Đường dẫn trong bucket
 * @param {Buffer} buffer - Nội dung file
 * @param {string} contentType - MIME type
 * @return {Promise<string>} - URL tương đối /files/<key>
 */
const putFile = async (key, buffer, contentType) => {
  await bucket().put(key, buffer, {
    httpMetadata: { contentType: contentType || "application/octet-stream" },
  });
  return `${FILES_PREFIX}${key}`;
};

/**
 * Lấy key R2 từ URL đã lưu (bỏ qua URL ngoài như ui-avatars.com)
 * @param {string} url - URL lưu trong database
 * @return {string|null}
 */
const keyFromUrl = (url) =>
  typeof url === "string" && url.startsWith(FILES_PREFIX)
    ? url.slice(FILES_PREFIX.length)
    : null;

/**
 * Xoá nhiều file trên R2 (xoá không tốn phí)
 * @param {Array<string>} keys - Danh sách key
 * @return {Promise<void>}
 */
const deleteFiles = async (keys) => {
  // Without R2, deleting database records must not attempt bucket cleanup.
  if (!imageStorageEnabled()) return;
  const list = keys.filter(Boolean);
  for (let i = 0; i < list.length; i += R2_DELETE_BATCH) {
    await bucket().delete(list.slice(i, i + R2_DELETE_BATCH));
  }
};

module.exports = {
  imageStorageEnabled,
  FILES_PREFIX,
  safeFileName,
  putFile,
  keyFromUrl,
  deleteFiles,
};
