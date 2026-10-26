const { get, run } = require("../config/database");

// Field trong API (camelCase) -> cột trong bảng users
const COLUMNS = {
  userId: "user_id",
  email: "email",
  password: "password",
  displayName: "display_name",
  profilePic: "profile_pic",
  methodSignUp: "method_sign_up",
  role: "role",
  fcmToken: "fcm_token",
  isActive: "is_active",
  // scannedData: "scanned_data",
  pairId: "pair_id",
  createdAt: "created_at",
  updatedAt: "updated_at",
  lastLogin: "last_login",
};

const toColumnValue = (field, value) => {
  if (field === "isActive") return value ? 1 : 0;
  if (field === "scannedData") return JSON.stringify(value || []);
  return value;
};

const fromRow = (row) => {
  const user = {};
  for (const [field, column] of Object.entries(COLUMNS)) {
    if (row[column] !== null && row[column] !== undefined) user[field] = row[column];
  }
  user.isActive = Boolean(row.is_active);
  user.scannedData = JSON.parse(row.scanned_data || "[]");
  return user;
};

const knownFields = (data) => Object.keys(data).filter((field) => COLUMNS[field]);

/**
 * Tạo dữ liệu user theo schema chuẩn
 * @param {Object} data - Dữ liệu từ request body
 * @param {string} uid - ID của người dùng
 * @return {Object} - Dữ liệu user đã chuẩn hóa
 */
const prepareUserData = (data, uid) => {
  return {
    userId: uid,
    email: data.email,
    displayName: data.displayName,
    profilePic: `https://ui-avatars.com/api/?name=${encodeURIComponent(data.displayName)}`,
    methodSignUp: "email",
    role: "user",
    fcmToken: "",
    isActive: false,
    scannedData: [],
    password: data.password,
    createdAt: new Date().toISOString(),
  };
};

/**
 * Thêm user vào database
 * @param {Object} userData - Thông tin người dùng (từ prepareUserData)
 * @return {Promise<void>}
 */
const createUser = async (userData) => {
  const fields = knownFields(userData);
  await run(
    `INSERT INTO users (${fields.map((field) => COLUMNS[field]).join(",")})
     VALUES (${fields.map(() => "?").join(",")})`,
    fields.map((field) => toColumnValue(field, userData[field]))
  );
};

/**
 * Lấy thông tin user theo ID
 * @param {string} uid - ID của người dùng
 * @return {Promise<Object>} - Dữ liệu người dùng
 */
const getUserById = async (uid) => {
  const row = await get("SELECT * FROM users WHERE user_id=?", [uid]);
  if (!row) {
    throw new Error("User not found");
  }
  return fromRow(row);
};

/**
 * Update thông tin user
 * @param {string} uid - ID của người dùng
 * @param {Object} updatedData - Dữ liệu cần update (camelCase)
 * @return {Promise<void>}
 */
const updateUser = async (uid, updatedData) => {
  const fields = knownFields(updatedData).filter((field) => field !== "userId");
  if (fields.length === 0) return;

  const result = await run(
    `UPDATE users SET ${fields.map((field) => `${COLUMNS[field]}=?`).join(",")} WHERE user_id=?`,
    [...fields.map((field) => toColumnValue(field, updatedData[field])), uid]
  );
  if (!result.meta.changes) {
    throw new Error("User not found");
  }
};

/**
 * Xóa user (OTP và scan của user bị xóa theo nhờ ON DELETE CASCADE)
 * @param {string} uid - ID của người dùng
 * @return {Promise<void>}
 */
const deleteUser = async (uid) => {
  await run("DELETE FROM users WHERE user_id=?", [uid]);
};

/**
 * Lấy user theo email (không phân biệt hoa thường)
 * @param {string} email - Email của người dùng
 * @return {Promise<Object|null>} - Dữ liệu người dùng hoặc null
 */
const getUserByEmail = async (email) => {
  const row = await get("SELECT * FROM users WHERE email=?", [email]);
  return row ? fromRow(row) : null;
};

module.exports = {
  prepareUserData,
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  getUserByEmail,
};
