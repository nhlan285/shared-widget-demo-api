// Gửi email qua Gmail SMTP. nodemailer không chạy trên Workers nên dùng
// worker-mailer (SMTP qua cloudflare:sockets). Bản CommonJS của nó require()
// "cloudflare:sockets", bundler của Workers không hỗ trợ, nên phải import() bản ESM.
const loadWorkerMailer = () => import("worker-mailer/dist/index.mjs");
const { optionalBinding } = require("../config/cloudflare");
const { OTP_EXPIRED_MINUTES, isDevelopment } = require("./constant");

const APP_NAME = "Shared Widget";

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/**
 * Gửi 1 email HTML từ tài khoản EMAIL_USER
 * @param {Object} options - { to, subject, html }
 * @return {Promise<void>}
 */
const sendMail = async ({ to, subject, html }) => {
  const user = optionalBinding("EMAIL_USER");
  const pass = optionalBinding("EMAIL_PASS");

  if (!user || !pass) {
    // Local / test: không cần tài khoản Gmail, OTP được trả trong response
    if (isDevelopment()) {
      console.warn(`EMAIL_USER/EMAIL_PASS not set, skipped email "${subject}" to ${to}`);
      return;
    }
    throw new Error("Missing Cloudflare binding: EMAIL_USER / EMAIL_PASS");
  }

  const { WorkerMailer } = await loadWorkerMailer();
  await WorkerMailer.send(
    {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      credentials: { username: user, password: pass },
      authType: "plain",
    },
    {
      from: { name: `${APP_NAME} Support`, email: user },
      to,
      subject,
      html,
    }
  );
};

/**
 * Gửi email OTP để xác thực email khi đăng ký
 * @param {string} email - Email của người nhận
 * @param {string} otp - Mã OTP
 * @param {string} displayName - Tên hiển thị của người dùng
 * @return {Promise<void>}
 */
const sendVerifyEmailOTP = async (email, otp, displayName) => {
  await sendMail({
    to: email,
    subject: `Email Verification Code - ${APP_NAME}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <h2 style="color: #66CCCC;">${APP_NAME}</h2>
          <p style="color: #666;">Email Verification</p>
        </div>

        <div style="margin-bottom: 30px;">
          <p>Hello ${escapeHtml(displayName || "User")},</p>
          <p>Thank you for signing up for ${APP_NAME}. To activate your account, please enter the verification code below in the app:</p>

          <div style="background-color: #f5f5f5; padding: 15px; text-align: center; margin: 20px 0; border-radius: 5px;">
            <h2 style="margin: 0; letter-spacing: 5px; font-family: monospace;">${otp}</h2>
          </div>

          <p>This code is valid for <strong>${OTP_EXPIRED_MINUTES} minutes</strong> only.</p>
          <p>If you did not sign up for a ${APP_NAME} account, please ignore this email.</p>
        </div>

        <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e0e0e0; color: #999; font-size: 12px;">
          <p>This is an automated email. Please do not reply to this message.</p>
          <p>&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
        </div>
      </div>
    `,
  });
};

const sendDeviceLoginOTP = async (email, otp, displayName) => {
  await sendMail({
    to: email,
    subject: `New Device Login - ${APP_NAME}`,
    html: `<p>Hello ${escapeHtml(displayName || "User")},</p>
      <p>Confirm your login on a new device using this code:</p>
      <h2>${escapeHtml(otp)}</h2>
      <p>Valid for ${OTP_EXPIRED_MINUTES} minutes. Your current session stays active
      until verification succeeds. If this was not you, do not share this code.</p>`,
  });
};

module.exports = {
  sendDeviceLoginOTP,
  sendVerifyEmailOTP,
};
