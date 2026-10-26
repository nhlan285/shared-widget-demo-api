const express = require("express");
const deviceController = require("../controllers/deviceController");
const { authenticateToken } = require("../middlewares/authMiddleware");
const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     CurrentSessionDevice:
 *       type: object
 *       required:
 *       - deviceId
 *       - platform
 *       - pushRegistered
 *       - verifiedAt
 *       - lastLoginAt
 *       properties:
 *         deviceId:
 *           type: string
 *           format: uuid
 *           pattern: ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$
 *         platform:
 *           type: string
 *           enum:
 *           - android
 *         pushRegistered:
 *           type: boolean
 *         verifiedAt:
 *           type: string
 *           format: date-time
 *         lastLoginAt:
 *           type: string
 *           format: date-time
 *     CurrentSessionDeviceResponse:
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
 *           $ref: '#/components/schemas/CurrentSessionDevice'
 *         timestamp:
 *           type: string
 *           format: date-time
 *     DevicePushRemovedResponse:
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
 *     DevicePushRequest:
 *       type: object
 *       required:
 *       - fcmToken
 *       properties:
 *         fcmToken:
 *           type: string
 *           minLength: 1
 *           maxLength: 4096
 *           pattern: ^\S+$
 *       additionalProperties: false
 * /devices/current:
 *   get:
 *     tags:
 *     - Devices
 *     summary: Get the current authenticated device
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CurrentSessionDeviceResponse'
 *       '400':
 *         description: Invalid request body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     security:
 *     - bearerAuth: []
 *   put:
 *     tags:
 *     - Devices
 *     summary: Register or replace FCM token for the current session
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CurrentSessionDeviceResponse'
 *       '400':
 *         description: Invalid request body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DevicePushRequest'
 *     security:
 *     - bearerAuth: []
 *   delete:
 *     tags:
 *     - Devices
 *     summary: Remove FCM registration without removing trust or logging out
 *     responses:
 *       '200':
 *         description: Success
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DevicePushRemovedResponse'
 *       '400':
 *         description: Invalid request body.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
 *     security:
 *     - bearerAuth: []
 */

router.use(authenticateToken);
router.get("/current", deviceController.getCurrentDevice);
router.put("/current", deviceController.registerDevice);
router.delete("/current", deviceController.unregisterDevice);
module.exports = router;
