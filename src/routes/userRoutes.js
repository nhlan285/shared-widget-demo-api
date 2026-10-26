const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * /user-service/me:
 *   get:
 *     tags: [User Management]
 *     summary: Get current user information
 *     description: Retrieve detailed information about the currently authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         userInfo:
 *                           $ref: '#/components/schemas/User'
 *             example:
 *               statusCode: 200
 *               message: "User information retrieved successfully"
 *               data:
 *                 userInfo:
 *                   userId: "6f1c2a8e-0d4b-4c39-9f5e-2b7d9a1e4c30"
 *                   email: "john.doe456789@yopmail.com"
 *                   displayName: "John Doe"
 *                   profilePic: "https://ui-avatars.com/api/?name=John%20Doe"
 *                   methodSignUp: "email"
 *                   role: "user"
 *                   fcmToken: ""
 *                   isActive: true
 *                   createdAt: "2023-01-01T00:00:00.000Z"
 *               timestamp: "2023-12-01T10:00:00.000Z"
 *       401:
 *         description: Unauthorized - missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.get("/me", authenticateToken, userController.getUserInfo);

/**
 * @swagger
 * /user-service/me:
 *   put:
 *     tags: [User Management]
 *     summary: Update user profile with avatar upload
 *     description: Update user profile information including profile picture upload (supports both multipart/form-data with file upload and application/json without file)
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               displayName:
 *                 type: string
 *                 minLength: 1
 *                 pattern: '\S'
 *                 description: Optional display name, trimmed and non-empty when provided
 *                 example: "John Doe Updated"
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Profile picture file (max 10MB)
 *             required:
 *               - file
 *           encoding:
 *             file:
 *               contentType: image/jpeg, image/png
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UserProfile'
 *           example:
 *             displayName: "John Smith"
 *     responses:
 *       200:
 *         description: User information updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       type: object
 *                       properties:
 *                         userInfo:
 *                           $ref: '#/components/schemas/User'
 *             examples:
 *               json_update:
 *                 summary: JSON update response
 *                 value:
 *                   statusCode: 200
 *                   message: "User information updated successfully"
 *                   data:
 *                     userInfo:
 *                       userId: "6f1c2a8e-0d4b-4c39-9f5e-2b7d9a1e4c30"
 *                       email: "john.doe456789@yopmail.com"
 *                       displayName: "John Smith"
 *                       profilePic: "https://ui-avatars.com/api/?name=John%20Smith"
 *                       methodSignUp: "email"
 *                       role: "user"
 *                       fcmToken: ""
 *                       isActive: true
 *                       createdAt: "2023-01-01T00:00:00.000Z"
 *                       updatedAt: "2023-12-01T10:00:00.000Z"
 *                   timestamp: "2023-12-01T10:00:00.000Z"
 *               multipart_upload:
 *                 summary: File upload response
 *                 value:
 *                   statusCode: 200
 *                   message: "Success"
 *                   data:
 *                     displayName: "John Smith"
 *                     profilePic: "https://shared-widget-be.example.workers.dev/files/profile_pictures/6f1c.../profile.jpg"
 *                   timestamp: "2023-12-01T10:00:00.000Z"
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               no_fields:
 *                 value:
 *                   statusCode: 400
 *                   error: "Validation Failed"
 *                   message: "No valid fields to update"
 *                   timestamp: "2023-12-01T10:00:00.000Z"
 *       401:
 *         description: Unauthorized - missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: User not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 */
router.put("/me", authenticateToken, userController.updateUserInfo);

module.exports = router;
