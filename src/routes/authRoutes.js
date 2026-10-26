const express = require("express");
const authController = require("../controllers/authController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     SessionTokens:
 *       type: object
 *       required:
 *       - accessToken
 *       - refreshToken
 *       - tokenType
 *       - expiresIn
 *       properties:
 *         accessToken:
 *           type: string
 *         refreshToken:
 *           type: string
 *         tokenType:
 *           type: string
 *           enum:
 *           - Bearer
 *         expiresIn:
 *           type: string
 *     DeviceLoginData:
 *       type: object
 *       required:
 *       - isOTP
 *       - user
 *       - tokens
 *       - deviceCredential
 *       properties:
 *         isOTP:
 *           type: boolean
 *           enum:
 *           - false
 *         user:
 *           type: object
 *           required:
 *           - userId
 *           - email
 *           - displayName
 *           - profilePic
 *           properties:
 *             userId:
 *               type: string
 *               format: uuid
 *               pattern: ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$
 *             email:
 *               type: string
 *               format: email
 *             displayName:
 *               type: string
 *             profilePic:
 *               type: string
 *         tokens:
 *           $ref: '#/components/schemas/SessionTokens'
 *         deviceCredential:
 *           type: string
 *           pattern: ^[0-9a-f]{64}$
 *           description: Device secret returned only to this installation; store securely and keep after
 *             logout.
 *     DeviceOTPRequired:
 *       type: object
 *       required:
 *       - isOTP
 *       - challengeId
 *       - emailMasked
 *       - expiresIn
 *       - resendAfter
 *       properties:
 *         isOTP:
 *           type: boolean
 *           enum:
 *           - true
 *         challengeId:
 *           type: string
 *           format: uuid
 *           pattern: ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$
 *         emailMasked:
 *           type: string
 *         expiresIn:
 *           type: integer
 *         resendAfter:
 *           type: integer
 *         otp:
 *           type: string
 *           description: Development only.
 *     DeviceLoginResponse:
 *       type: object
 *       required:
 *       - statusCode
 *       - message
 *       - data
 *       - timestamp
 *       properties:
 *         statusCode:
 *           type: integer
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/DeviceLoginData'
 *         timestamp:
 *           type: string
 *           format: date-time
 *     LoginResultResponse:
 *       type: object
 *       required:
 *       - statusCode
 *       - message
 *       - data
 *       - timestamp
 *       properties:
 *         statusCode:
 *           type: integer
 *         message:
 *           type: string
 *         data:
 *           oneOf:
 *           - $ref: '#/components/schemas/DeviceLoginData'
 *           - $ref: '#/components/schemas/DeviceOTPRequired'
 *         timestamp:
 *           type: string
 *           format: date-time
 *     DeviceChallengeResponse:
 *       type: object
 *       required:
 *       - statusCode
 *       - message
 *       - data
 *       - timestamp
 *       properties:
 *         statusCode:
 *           type: integer
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/DeviceOTPRequired'
 *         timestamp:
 *           type: string
 *           format: date-time
 *     RefreshSessionResponse:
 *       type: object
 *       required:
 *       - statusCode
 *       - message
 *       - data
 *       - timestamp
 *       properties:
 *         statusCode:
 *           type: integer
 *         message:
 *           type: string
 *         data:
 *           $ref: '#/components/schemas/SessionTokens'
 *         timestamp:
 *           type: string
 *           format: date-time
 *     AuthLogoutResponse:
 *       type: object
 *       required:
 *       - statusCode
 *       - message
 *       - data
 *       - timestamp
 *       properties:
 *         statusCode:
 *           type: integer
 *         message:
 *           type: string
 *         data:
 *           type: object
 *           nullable: true
 *           enum:
 *           - null
 *         timestamp:
 *           type: string
 *           format: date-time
 *     VerifyEmailDeviceRequest:
 *       type: object
 *       required:
 *       - email
 *       - otp
 *       - deviceId
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         otp:
 *           type: string
 *           pattern: ^[0-9]{6}$
 *         deviceId:
 *           type: string
 *           format: uuid
 *           pattern: ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$
 *     VerifyDeviceLoginRequest:
 *       type: object
 *       required:
 *       - challengeId
 *       - otp
 *       properties:
 *         challengeId:
 *           type: string
 *           format: uuid
 *           pattern: ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$
 *         otp:
 *           type: string
 *           pattern: ^[0-9]{6}$
 *     DeviceChallengeRequest:
 *       type: object
 *       required:
 *       - challengeId
 *       properties:
 *         challengeId:
 *           type: string
 *           format: uuid
 *           pattern: ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$
 * /auth-service/register:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Register an account
 *     responses:
 *       '201':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *               - statusCode
 *               - message
 *               - data
 *               - timestamp
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/VerificationCodeSent'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       '400':
 *         description: Invalid request or email already registered.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserRegistration'
 * /auth-service/verify-email:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Verify email and create the first device session
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceLoginResponse'
 *       '400':
 *         description: Invalid request or OTP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '404':
 *         description: Account not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: Verification already completed or state changed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyEmailDeviceRequest'
 * /auth-service/login:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Sign in with a trusted device or request device OTP
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/LoginResultResponse'
 *       '400':
 *         description: Invalid request or OTP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Invalid credentials or revoked session.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: Login state changed; sign in again.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: OTP cooldown or account send limit reached.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Unexpected server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '503':
 *         description: OTP email could not be delivered; old session is preserved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     description: Always requires a UUID v4 deviceId. A trusted device must also supply its deviceCredential.
 *       Unknown/unproven devices receive isOTP=true and a challengeId, with no tokens. The old session stays
 *       active until verification succeeds.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserLogin'
 * /auth-service/resend-verification:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Resend registration email OTP
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               required:
 *               - statusCode
 *               - message
 *               - data
 *               - timestamp
 *               properties:
 *                 statusCode:
 *                   type: integer
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/VerificationCodeSent'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       '400':
 *         description: Already verified or invalid request.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '404':
 *         description: Account not found.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: Wait before resending.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *             - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 * /auth-service/refresh-token:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Rotate the current session refresh token
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RefreshSessionResponse'
 *       '400':
 *         description: Missing refresh token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Wrong token type, used refresh token or revoked session.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     description: Only the latest refresh token works. Serialize refresh requests on the client.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *             - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 * /auth-service/verify-device-login:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Verify OTP and switch to the new device
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceLoginResponse'
 *       '400':
 *         description: Invalid request or OTP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Inactive account.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: Login state changed; sign in again.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Unexpected server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     description: A challenge is single use and bound to its original device and expected session. Success
 *       retains trusted history and clears old FCM registration.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VerifyDeviceLoginRequest'
 * /auth-service/resend-device-login-otp:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Resend device login OTP
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DeviceChallengeResponse'
 *       '400':
 *         description: Invalid request or OTP.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '401':
 *         description: Invalid credentials or revoked session.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '409':
 *         description: Login state changed; sign in again.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '429':
 *         description: OTP cooldown or account send limit reached.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Unexpected server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '503':
 *         description: OTP email could not be delivered; old session is preserved.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     description: 60-second account cooldown and at most 5 sends per 10 minutes. Attempts are not reset
 *       by resend; previous code becomes invalid.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DeviceChallengeRequest'
 * /auth-service/logout:
 *   post:
 *     tags:
 *     - Authentication
 *     summary: Log out the current session
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthLogoutResponse'
 *       '401':
 *         description: Missing or revoked session.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '403':
 *         description: Invalid access token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       '500':
 *         description: Server error.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *     description: Clears current session and FCM registration, but retains trusted device history and credential.
 *       Old-session logout cannot affect the replacement session.
 *     security:
 *     - bearerAuth: []
 */

router.post("/register", authController.register);
router.post("/verify-email", authController.verifyEmail);
router.post("/login", authController.login);
router.post("/resend-verification", authController.resendVerification);
router.post("/refresh-token", authController.refreshToken);
router.post("/verify-device-login", authController.verifyDeviceLogin);
router.post("/resend-device-login-otp", authController.resendDeviceLoginOTP);
router.post("/logout", authenticateToken, authController.logout);
module.exports = router;
