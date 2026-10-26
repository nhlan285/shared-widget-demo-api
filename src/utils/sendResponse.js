// src/utils/sendResponse.js
const { FILES_PREFIX } = require("../config/storage");

/**
 * Origin công khai của request (worker.mjs đặt X-Forwarded-* theo URL thật)
 * @param {Object} req - Đối tượng request của Express
 * @return {string} - Ví dụ: https://shared-widget-be.<account>.workers.dev
 */
const publicOrigin = (req) => {
  const first = (value) => String(value || "").split(",")[0].trim();
  const protocol = first(req.get("x-forwarded-proto")) || req.protocol;
  const host = first(req.get("x-forwarded-host")) || req.get("host");
  return `${protocol}://${host}`;
};

/**
 * Đổi URL file tương đối (/files/...) thành URL tuyệt đối
 * @param {any} value - Dữ liệu trả về
 * @param {string} origin - Origin công khai
 * @return {any}
 */
const absoluteFileUrls = (value, origin) => {
  if (typeof value === "string" && value.startsWith(FILES_PREFIX)) return `${origin}${value}`;
  if (Array.isArray(value)) return value.map((item) => absoluteFileUrls(item, origin));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, absoluteFileUrls(item, origin)])
    );
  }
  return value;
};


/**
 * Tạo template phản hồi JSON
 * @param {Object} res - Đối tượng response từ Express
 * @param {number} statusCode - Mã trạng thái HTTP (ví dụ: 200, 400, 500)
 * @param {string} message - Thông báo đi kèm phản hồi
 * @param {any} data - Dữ liệu trả về (đối tượng, mảng, chuỗi, số, ...)
 * @return {Object} - Đối tượng JSON theo cấu trúc chuẩn
 */
const sendSuccessResponse = (res, statusCode, message, data = []) => {
  return res.status(statusCode).json({
    statusCode: statusCode,
    message: message,
    data: absoluteFileUrls(data, publicOrigin(res.req)),
    timestamp: new Date().toISOString(),
  });
};

/**
 * Tạo template phản hồi JSON
 * @param {Object} res - Đối tượng response của Express
 * @param {number} statusCode - Mã trạng thái HTTP (ví dụ: 200, 400, 500)
 * @param {string} error - Mã lỗi
 * @param {string} message - Thông báo lỗi
 * @returns {Object} - Đối tượng JSON theo cấu trúc chuẩn
 */
const sendErrorResponse = (res, statusCode, error, message) => {
  return res.status(statusCode).json({
    statusCode: statusCode,
    error: error,
    message: message,
    timestamp: new Date().toISOString(),
  });
};

// Xuất module theo CommonJS
module.exports = {
  publicOrigin,
  sendSuccessResponse,
  sendErrorResponse,
};
