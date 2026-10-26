// Password hashing with PBKDF2-SHA256 from Web Crypto. bcrypt in pure JS needs
// ~100 ms of CPU per hash, over the 10 ms Workers Free limit; native PBKDF2 at
// 100,000 iterations (the most Workers supports) takes a few milliseconds.
const { timingSafeEqual } = require("node:crypto");

const ITERATIONS = 100000;
const SCHEME = "pbkdf2-sha256";

const derive = async (password, salt, iterations) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256
  );
  return Buffer.from(bits);
};

/**
 * Mã hoá mật khẩu
 * @param {string} password - Mật khẩu gốc
 * @return {Promise<string>} - Dạng "pbkdf2-sha256$<iterations>$<salt>$<hash>"
 */
const hashPassword = async (password) => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return [SCHEME, ITERATIONS, Buffer.from(salt).toString("base64"), hash.toString("base64")].join("$");
};

/**
 * So sánh mật khẩu với chuỗi đã mã hoá
 * @param {string} password - Mật khẩu người dùng nhập
 * @param {string} stored - Chuỗi lưu trong database
 * @return {Promise<boolean>}
 */
const verifyPassword = async (password, stored) => {
  const [scheme, iterations, salt, hash] = String(stored || "").split("$");
  if (scheme !== SCHEME || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), Number(iterations));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

module.exports = { hashPassword, verifyPassword };
