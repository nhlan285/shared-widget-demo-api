const { hashPassword, verifyPassword } = require("../utils/password");
const { sendSuccessResponse, sendErrorResponse } = require("../utils/sendResponse");
const { validateEmail, validateDisplayName, validatePassword } = require("../utils/validators");
const { validDeviceId, validOTP, validCredential } = require("../utils/deviceValidators");
const { prepareUserData, createUser, deleteUser, getUserByEmail } = require("../models/userModel");
const { OTP_TYPES, createOTP, getOTP } = require("../models/otpModel");
const { sendVerifyEmailOTP } = require("../utils/emailUtils");
const { OTP_EXPIRED_MINUTES, OTP_RESEND_COOLDOWN_SECONDS, isDevelopment } = require("../utils/constant");
const authSessionService = require("../services/authSessionService");
const sessionModel = require("../models/sessionModel");
const { AuthError } = require("../utils/authError");

const maskEmail = (email) =>
  email.replace(/(.{3})(.*)(?=@)/, (_, head, rest) => head + rest.replace(/./g, "*"));

const sendVerificationCode = async (user) => {
  const otp = await createOTP(user.userId, OTP_TYPES.VERIFY_EMAIL);
  await sendVerifyEmailOTP(user.email, otp, user.displayName);
  return {
    otp: isDevelopment() ? otp : undefined,
    email: user.email,
    emailMasked: maskEmail(user.email),
    expiresIn: `${OTP_EXPIRED_MINUTES} minutes`,
  };
};

const authError = (res, error) => {
  if (error instanceof AuthError) {
    return sendErrorResponse(res, error.statusCode, error.code, error.message);
  }
  console.error("Authentication request failed");
  return sendErrorResponse(res, 500, "Internal Server Error", "Could not process authentication request");
};

class AuthController {
  register = async (req, res) => {
    const { email, password, displayName } = req.body || {};

    // Kiểm tra các trường bắt buộc
    if (!email || !password || displayName === undefined) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "Email, password and displayName are required"
      );
    }

    // Validate email
    if (!validateEmail(email)) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "Invalid email format"
      );
    }

    // Validate display name
    if (!validateDisplayName(displayName)) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "Display name must be a non-empty string"
      );
    }

    // Validate password
    if (!validatePassword(password)) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "Password must be at least 6 characters"
      );
    }

    try {
      // Check if email already exists
      const existingUser = await getUserByEmail(email);
      if (existingUser && existingUser.isActive) {
        return sendErrorResponse(
          res,
          400,
          "Invalid Account",
          "Email already in use"
        );
      }

      // Email đã đăng ký nhưng chưa xác thực: xóa bản cũ để đăng ký lại
      // (người nhập sai mật khẩu, hoặc người khác đăng ký trước bằng email này)
      if (existingUser) {
        await deleteUser(existingUser.userId);
      }

      // Mã hóa mật khẩu
      const hashedPassword = await hashPassword(password);

      // Thông tin lưu vào database (isActive = false cho tới khi xác thực OTP)
      const userData = prepareUserData(
        { email, displayName: displayName.trim(), password: hashedPassword },
        crypto.randomUUID()
      );

      await createUser(userData);

      // Gửi OTP xác thực email; gửi lỗi thì xóa user để có thể đăng ký lại
      let verification;
      try {
        verification = await sendVerificationCode(userData);
      } catch (error) {
        await deleteUser(userData.userId);
        throw error;
      }

      return sendSuccessResponse(
        res,
        201,
        "User created successfully. Verification code sent to your email",
        verification
      );
    } catch (error) {
      console.error("Registration Error:", error.message);

      // Hai request đăng ký cùng email cùng lúc
      if (error.message.includes("UNIQUE constraint failed: users.email")) {
        return sendErrorResponse(
          res,
          400,
          "Invalid Account",
          "Email already in use"
        );
      }

      return sendErrorResponse(
        res,
        500,
        "Internal Server Error",
        error.message
      );
    }
  };

  login = async (req, res) => {
    try {
      const { email, password, deviceId, deviceCredential } = req.body || {};
      if (!validateEmail(email) || typeof password !== "string" || !password) {
        return sendErrorResponse(res, 400, "Validation Failed", "Valid email and password are required");
      }
      const user = await getUserByEmail(email);
      if (!user || !await verifyPassword(password, user.password)) {
        return sendErrorResponse(res, 401, "Authentication Failed", "Invalid email or password");
      }
      if (!user.isActive) {
        return sendErrorResponse(res, 401, "Account Inactive", "Please verify your email first");
      }
      if (!validDeviceId(deviceId)
        || (deviceCredential !== undefined && !validCredential(deviceCredential))) {
        return sendErrorResponse(res, 400, "Validation Failed", "A UUID v4 deviceId and optional 64-character hexadecimal deviceCredential are required");
      }
      const data = await authSessionService.login(user, deviceId.toLowerCase(), deviceCredential);
      return sendSuccessResponse(res, 200,
        data.isOTP ? "Device verification required" : "Login successful", data);
    } catch (error) { return authError(res, error); }
  };

  verifyEmail = async (req, res) => {
    try {
      const { email, otp, deviceId } = req.body || {};
      if (!validateEmail(email) || !validOTP(otp) || !validDeviceId(deviceId)) {
        return sendErrorResponse(res, 400, "Validation Failed", "Valid email, 6-digit OTP and UUID v4 deviceId are required");
      }
      const user = await getUserByEmail(email);
      if (!user) return sendErrorResponse(res, 404, "User Not Found", "No account exists with this email");
      if (user.isActive) return sendErrorResponse(res, 400, "Already Verified", "This email is already verified");
      const data = await authSessionService.finishRegistration(user, deviceId.toLowerCase(), otp);
      return sendSuccessResponse(res, 200, "Email verified successfully", data);
    } catch (error) { return authError(res, error); }
  };

  resendVerification = async (req, res) => {
    const { email } = req.body || {};

    if (!email) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "Email is required"
      );
    }

    // Validate email format
    if (!validateEmail(email)) {
      return sendErrorResponse(
        res,
        400,
        "Validation Failed",
        "Invalid email format"
      );
    }

    try {
      const userDoc = await getUserByEmail(email);

      if (!userDoc) {
        return sendErrorResponse(
          res,
          404,
          "User Not Found",
          "No account exists with this email"
        );
      }

      if (userDoc.isActive) {
        return sendErrorResponse(
          res,
          400,
          "Already Verified",
          "This email is already verified"
        );
      }

      // Chặn gửi liên tục: phải chờ OTP_RESEND_COOLDOWN_SECONDS kể từ lần gửi trước
      const current = await getOTP(userDoc.userId, OTP_TYPES.VERIFY_EMAIL);
      if (current) {
        const elapsed = (Date.now() - new Date(current.createdAt).getTime()) / 1000;
        if (elapsed < OTP_RESEND_COOLDOWN_SECONDS) {
          return sendErrorResponse(
            res,
            429,
            "Too Many Requests",
            `Please wait ${Math.ceil(
              OTP_RESEND_COOLDOWN_SECONDS - elapsed
            )} seconds before requesting a new code`
          );
        }
      }

      const verification = await sendVerificationCode(userDoc);

      return sendSuccessResponse(
        res,
        200,
        "Verification code resent successfully",
        verification
      );
    } catch (error) {
      console.error("Resend Verification Error:", error.message);
      return sendErrorResponse(
        res,
        500,
        "Internal Server Error",
        error.message
      );
    }
  };

  refreshToken = async (req, res) => {
    try {
      const { refreshToken } = req.body || {};
      if (typeof refreshToken !== "string" || !refreshToken) {
        return sendErrorResponse(res, 400, "Validation Failed", "Refresh token is required");
      }
      const tokens = await authSessionService.refresh(refreshToken);
      return sendSuccessResponse(res, 200, "Token refreshed successfully", tokens);
    } catch (error) { return authError(res, error); }
  };

  verifyDeviceLogin = async (req, res) => {
    try {
      const { challengeId, otp } = req.body || {};
      if (!validDeviceId(challengeId) || !validOTP(otp)) {
        return sendErrorResponse(res, 400, "Validation Failed", "UUID v4 challengeId and 6-digit OTP are required");
      }
      const data = await authSessionService.verifyDeviceLogin(challengeId.toLowerCase(), otp);
      return sendSuccessResponse(res, 200, "Login successful", data);
    } catch (error) { return authError(res, error); }
  };

  resendDeviceLoginOTP = async (req, res) => {
    try {
      const { challengeId } = req.body || {};
      if (!validDeviceId(challengeId)) {
        return sendErrorResponse(res, 400, "Validation Failed", "UUID v4 challengeId is required");
      }
      const data = await authSessionService.resendDeviceOTP(challengeId.toLowerCase());
      return sendSuccessResponse(res, 200, "Device verification code resent", data);
    } catch (error) { return authError(res, error); }
  };

  logout = async (req, res) => {
    try {
      await sessionModel.logout(req.userId, req.sessionId);
      return sendSuccessResponse(res, 200, "Logged out successfully", null);
    } catch (error) { return authError(res, error); }
  };
}

module.exports = new AuthController();
