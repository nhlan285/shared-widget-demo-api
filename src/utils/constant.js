const { binding, optionalBinding } = require("../config/cloudflare");

// const time expired access token
const ACCESS_TOKEN_EXPIRED = "1d";

// const time expired refresh token
const REFRESH_TOKEN_EXPIRED = "30d";

// OTP gửi qua email: thời hạn, số lần nhập sai tối đa, thời gian chờ giữa 2 lần gửi lại
const OTP_EXPIRED_MINUTES = 2;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;
const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const DEVICE_OTP_WINDOW_MS = 10 * 60 * 1000;
const DEVICE_OTP_MAX_SENDS = 5;

// API Version for routes
const API_VERSION = "v1";

// Relative so Swagger works on workers.dev, a custom domain and wrangler dev
const BASE_URL = `/${API_VERSION}`;

// Max upload size for images (scan, profile picture)
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * JWT secret from the Worker secret JWT_SECRET
 * (`wrangler secret put JWT_SECRET`, or .dev.vars when running locally).
 * @return {string}
 */
const getJwtSecret = () => binding("JWT_SECRET");

/**
 * Đang chạy local / test (biến NODE_ENV=development trong .dev.vars).
 * Khi đó API trả kèm OTP trong response và cho phép chạy không cần EMAIL_USER/EMAIL_PASS.
 * @return {boolean}
 */
const isDevelopment = () => optionalBinding("NODE_ENV") === "development";

module.exports = {
  ACCESS_TOKEN_EXPIRED,
  REFRESH_TOKEN_EXPIRED,
  API_VERSION,
  BASE_URL,
  MAX_FILE_SIZE,
  OTP_EXPIRED_MINUTES,
  OTP_MAX_ATTEMPTS,
  OTP_RESEND_COOLDOWN_SECONDS,
  SESSION_LIFETIME_MS,
  DEVICE_OTP_WINDOW_MS,
  DEVICE_OTP_MAX_SENDS,
  CODE_ALPHABET,
  getJwtSecret,
  isDevelopment,
};
