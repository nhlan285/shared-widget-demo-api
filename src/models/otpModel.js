const { get, run } = require("../config/database");
const { OTP_EXPIRED_MINUTES, OTP_MAX_ATTEMPTS } = require("../utils/constant");

// Các loại OTP
const OTP_TYPES = {
  VERIFY_EMAIL: "verify_email",
};

/**
 * Lỗi do người dùng nhập OTP sai / hết hạn (controller trả 400)
 */
class OtpError extends Error {
  name = "OtpError";
}

/**
 * Tạo OTP ngẫu nhiên gồm các chữ số
 * @param {number} length - Độ dài của OTP
 * @return {string} - OTP đã tạo
 */
const generateOTP = (length = 6) => {
  const values = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(values, (value) => value % 10).join("");
};

/**
 * Tạo và lưu OTP mới cho user (ghi đè OTP cũ cùng loại)
 * @param {string} userId - ID của user
 * @param {string} type - Loại OTP (OTP_TYPES)
 * @return {Promise<string>} - OTP đã tạo
 */
const createOTP = async (userId, type) => {
  const otp = generateOTP(6);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + OTP_EXPIRED_MINUTES * 60 * 1000);

  await run(
    `INSERT INTO otp_codes (user_id, type, otp, attempts, expires_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?)
     ON CONFLICT (user_id, type) DO UPDATE SET
       otp=excluded.otp, attempts=0, expires_at=excluded.expires_at, created_at=excluded.created_at`,
    [userId, type, otp, expiresAt.toISOString(), now.toISOString()]
  );

  return otp;
};

/**
 * Lấy OTP hiện tại của user
 * @param {string} userId - ID của user
 * @param {string} type - Loại OTP (OTP_TYPES)
 * @return {Promise<Object|null>} - { otp, attempts, expiresAt, createdAt } hoặc null
 */
const getOTP = async (userId, type) => {
  const row = await get("SELECT * FROM otp_codes WHERE user_id=? AND type=?", [userId, type]);
  if (!row) return null;
  return {
    otp: row.otp,
    attempts: row.attempts,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
};

/**
 * Xóa OTP của user
 * @param {string} userId - ID của user
 * @param {string} type - Loại OTP (OTP_TYPES)
 * @return {Promise<void>}
 */
const deleteOTP = async (userId, type) => {
  await run("DELETE FROM otp_codes WHERE user_id=? AND type=?", [userId, type]);
};

// Consumed together with account activation/session creation by sessionModel.
const attemptRegistrationOTP = (userId) => get(`UPDATE otp_codes SET attempts = attempts + 1
  WHERE user_id = ? AND type = 'verify_email' RETURNING *`, [userId]);

/**
 * Xác thực OTP, xóa OTP khi đúng
 * @param {string} userId - ID của user
 * @param {string} type - Loại OTP (OTP_TYPES)
 * @param {string} otp - OTP người dùng nhập
 * @return {Promise<boolean>} - true nếu đúng, ném OtpError nếu sai
 */
const verifyOTP = async (userId, type, otp) => {
  // Tăng số lần thử trong cùng câu lệnh để các request song song không vượt giới hạn
  const row = await get(
    `UPDATE otp_codes SET attempts = attempts + 1
     WHERE user_id=? AND type=? RETURNING *`,
    [userId, type]
  );

  // Kiểm tra OTP có tồn tại không
  if (!row) {
    throw new OtpError("OTP not found. Please request a new one.");
  }

  // Kiểm tra OTP đã hết hạn chưa
  if (new Date() > new Date(row.expires_at)) {
    await deleteOTP(userId, type);
    throw new OtpError("OTP has expired. Please request a new one.");
  }

  // Kiểm tra số lần nhập sai
  if (row.attempts > OTP_MAX_ATTEMPTS) {
    await deleteOTP(userId, type);
    throw new OtpError("Too many failed attempts. Please request a new one.");
  }

  // So sánh chuỗi với chuỗi
  if (row.otp !== String(otp).trim()) {
    throw new OtpError("Invalid OTP. Please try again.");
  }

  // Xóa OTP sau khi xác thực thành công
  await deleteOTP(userId, type);
  return true;
};

module.exports = {
  OTP_TYPES,
  attemptRegistrationOTP,
  OtpError,
  createOTP,
  getOTP,
  deleteOTP,
  verifyOTP,
};
