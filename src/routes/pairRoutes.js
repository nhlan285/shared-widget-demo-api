const express = require("express");
const pairController = require("../controllers/pairController");
const {
  authenticateToken,
} = require("../middlewares/authMiddleware");

const router = express.Router();

router.use(authenticateToken);
/**
 * @swagger
 * /pairs/current:
 *   get:
 *     tags:
 *       - Pairs
 *     summary: Get the current pair
 *     security:
 *       - bearerAuth: []
 *     description: Returns only the authenticated user's active private space. No pair history is exposed.
 *     responses:
 *       '200':
 *         description: 'Current pair, or data: null when unpaired.'
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CurrentPairResponse'
 *             examples:
 *               connected:
 *                 summary: User has an active pair
 *                 value:
 *                   statusCode: 200
 *                   message: Current pair retrieved
 *                   data:
 *                     pairId: 550e8400-e29b-41d4-a716-446655440000
 *                     timezone: Asia/Ho_Chi_Minh
 *                     anniversaryDate: null
 *                     createdAt: '2026-10-17T08:00:00.000Z'
 *                     members:
 *                       - userId: 550e8400-e29b-41d4-a716-446655440001
 *                         displayName: An
 *                         slot: 1
 *                       - userId: 550e8400-e29b-41d4-a716-446655440002
 *                         displayName: Binh
 *                         slot: 2
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *               unpaired:
 *                 summary: User has no active pair
 *                 value:
 *                   statusCode: 200
 *                   message: No active pair
 *                   data: null
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *       '401':
 *         description: Missing access token or user identity.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingToken:
 *                 summary: No Bearer token
 *                 value:
 *                   statusCode: 401
 *                   error: Access Denied
 *                   message: Access Token Required
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *               missingIdentity:
 *                 summary: Token has no user identity
 *                 value:
 *                   statusCode: 401
 *                   error: Unauthorized
 *                   message: User identity is required
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *       '403':
 *         description: Invalid or expired access token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 403
 *               error: Invalid Token
 *               message: Access Token Invalid Or Expired
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '500':
 *         description: Unexpected pair query or mutation failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 500
 *               error: Internal Server Error
 *               message: Could not process pair request
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *   patch:
 *     tags:
 *       - Pairs
 *     summary: Update the current pair anniversary
 *     security:
 *       - bearerAuth: []
 *     description: Updates only anniversaryDate. No pair ID or user ID is accepted in the body.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PairAnniversaryRequest'
 *           examples:
 *             setDate:
 *               summary: Set anniversary
 *               value:
 *                 anniversaryDate: '2026-10-17'
 *             clearDate:
 *               summary: Remove anniversary
 *               value:
 *                 anniversaryDate: null
 *     responses:
 *       '200':
 *         description: Anniversary updated.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PairAnniversaryResponse'
 *             examples:
 *               updated:
 *                 summary: Anniversary set
 *                 value:
 *                   statusCode: 200
 *                   message: Anniversary updated
 *                   data:
 *                     pairId: 550e8400-e29b-41d4-a716-446655440000
 *                     anniversaryDate: '2026-10-17'
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *               cleared:
 *                 summary: Anniversary removed
 *                 value:
 *                   statusCode: 200
 *                   message: Anniversary updated
 *                   data:
 *                     pairId: 550e8400-e29b-41d4-a716-446655440000
 *                     anniversaryDate: null
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *       '400':
 *         description: Missing anniversaryDate, invalid date, or unexpected body fields.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 400
 *               error: Validation Failed
 *               message: 'Only anniversaryDate is allowed: YYYY-MM-DD or null'
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '401':
 *         description: Missing access token or user identity.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingToken:
 *                 summary: No Bearer token
 *                 value:
 *                   statusCode: 401
 *                   error: Access Denied
 *                   message: Access Token Required
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *               missingIdentity:
 *                 summary: Token has no user identity
 *                 value:
 *                   statusCode: 401
 *                   error: Unauthorized
 *                   message: User identity is required
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *       '403':
 *         description: Invalid or expired access token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 403
 *               error: Invalid Token
 *               message: Access Token Invalid Or Expired
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '404':
 *         description: The authenticated user has no active pair.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 404
 *               error: Pair Not Found
 *               message: You do not have an active pair
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '409':
 *         description: The pair stopped being active before the mutation completed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 409
 *               error: Pair Changed
 *               message: The pair is no longer active
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '500':
 *         description: Unexpected pair query or mutation failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 500
 *               error: Internal Server Error
 *               message: Could not process pair request
 *               timestamp: '2026-10-17T08:00:00.000Z'
 * /pairs/current/disconnect:
 *   post:
 *     tags:
 *       - Pairs
 *     summary: Disconnect the current pair
 *     security:
 *       - bearerAuth: []
 *     description: >-
 *       No request body. Disconnects the authenticated user's active pair; subsequent current-pair
 *       requests return data: null for both members.
 *     responses:
 *       '200':
 *         description: Pair disconnected; data is null.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/PairDisconnectResponse'
 *             example:
 *               statusCode: 200
 *               message: Pair disconnected
 *               data: null
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '401':
 *         description: Missing access token or user identity.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missingToken:
 *                 summary: No Bearer token
 *                 value:
 *                   statusCode: 401
 *                   error: Access Denied
 *                   message: Access Token Required
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *               missingIdentity:
 *                 summary: Token has no user identity
 *                 value:
 *                   statusCode: 401
 *                   error: Unauthorized
 *                   message: User identity is required
 *                   timestamp: '2026-10-17T08:00:00.000Z'
 *       '403':
 *         description: Invalid or expired access token.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 403
 *               error: Invalid Token
 *               message: Access Token Invalid Or Expired
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '404':
 *         description: The authenticated user has no active pair.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 404
 *               error: Pair Not Found
 *               message: You do not have an active pair
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '409':
 *         description: The pair stopped being active before the mutation completed.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 409
 *               error: Pair Changed
 *               message: The pair is no longer active
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '500':
 *         description: Unexpected pair query or mutation failure.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 500
 *               error: Internal Server Error
 *               message: Could not process pair request
 *               timestamp: '2026-10-17T08:00:00.000Z'
 */
router.get(
  "/current",
  pairController.getCurrentPair
);

router.patch(
  "/current",
  pairController.updateCurrentPair
);

router.post(
  "/current/disconnect",
  pairController.disconnectCurrentPair
);

module.exports = router;