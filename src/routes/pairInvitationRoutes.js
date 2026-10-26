const express = require("express");
const {
  authenticateToken,
} = require("../middlewares/authMiddleware");
const invitationController = require(
  "../controllers/pairInvitationController"
);

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     PairInvitation:
 *       type: object
 *       required: [invitationId, code, inviteUrl, qrContent, expiresAt]
 *       properties:
 *         invitationId:
 *           type: string
 *           format: uuid
 *         code:
 *           type: string
 *           example: K8P3M7Q2
 *         inviteUrl:
 *           type: string
 *           format: uri
 *         qrContent:
 *           type: string
 *           description: Same value as inviteUrl
 *         expiresAt:
 *           type: string
 *           format: date-time
 *   responses:
 *     PairInvitationError:
 *       description: Request rejected or could not be processed
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *
 * /pair-invitations:
 *   post:
 *     tags: [Pair Invitations]
 *     summary: Create a new invitation
 *     description: Replaces the previous pending invitation. No request body.
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Invitation created
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   required: [data]
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/PairInvitation'
 *       401:
 *         $ref: '#/components/responses/PairInvitationError'
 *       403:
 *         $ref: '#/components/responses/PairInvitationError'
 *       409:
 *         $ref: '#/components/responses/PairInvitationError'
 *       500:
 *         $ref: '#/components/responses/PairInvitationError'
 *       503:
 *         $ref: '#/components/responses/PairInvitationError'
 */
router.post(
  "/",
  authenticateToken,
  invitationController.createInvitation
);
/**
 * @swagger
 * components:
 *   schemas:
 *     InvitationInput:
 *       description: >-
 *         Exactly one credential: code (trimmed and uppercased) or linkToken (the t query parameter of
 *         the invite URL).
 *       oneOf:
 *         - type: object
 *           additionalProperties: false
 *           required:
 *             - code
 *           properties:
 *             code:
 *               type: string
 *               pattern: ^\s*[A-Za-z0-9]{8}\s*$
 *               example: K8P3M7Q2
 *         - type: object
 *           additionalProperties: false
 *           required:
 *             - linkToken
 *           properties:
 *             linkToken:
 *               type: string
 *               pattern: ^[a-f0-9]{64}$
 *               example: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
 *     InvitationPreview:
 *       type: object
 *       required:
 *         - invitationId
 *         - inviter
 *         - expiresAt
 *       properties:
 *         invitationId:
 *           type: string
 *           format: uuid
 *         inviter:
 *           type: object
 *           required:
 *             - userId
 *             - displayName
 *           properties:
 *             userId:
 *               type: string
 *               format: uuid
 *             displayName:
 *               type: string
 *         expiresAt:
 *           type: string
 *           format: date-time
 *     AcceptedPair:
 *       type: object
 *       required:
 *         - pairId
 *         - status
 *         - timezone
 *         - anniversaryDate
 *         - createdAt
 *       properties:
 *         pairId:
 *           type: string
 *           format: uuid
 *         status:
 *           type: string
 *           enum:
 *             - active
 *         timezone:
 *           type: string
 *           example: Asia/Ho_Chi_Minh
 *         anniversaryDate:
 *           type: string
 *           format: date
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *     InvitationPreviewResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/SuccessResponse'
 *         - type: object
 *           required:
 *             - statusCode
 *             - message
 *             - data
 *             - timestamp
 *           properties:
 *             data:
 *               $ref: '#/components/schemas/InvitationPreview'
 *     InvitationAcceptResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/SuccessResponse'
 *         - type: object
 *           required:
 *             - statusCode
 *             - message
 *             - data
 *             - timestamp
 *           properties:
 *             data:
 *               $ref: '#/components/schemas/AcceptedPair'
 *     InvitationRevokeResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/SuccessResponse'
 *         - type: object
 *           required:
 *             - statusCode
 *             - message
 *             - data
 *             - timestamp
 *           properties:
 *             data:
 *               type: object
 *               nullable: true
 *               enum:
 *                 - null
 *               description: Always null after revoke.
 *   responses:
 *     InvitationInvalidInput:
 *       description: Invalid input, or trying to accept/preview your own invitation.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 400
 *             error: Validation Failed
 *             message: Provide exactly one of code or linkToken
 *             timestamp: '2026-10-17T08:00:00.000Z'
 *     InvitationUnauthorized:
 *       description: Missing access token or user identity.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 401
 *             error: Access Denied
 *             message: Access Token Required
 *             timestamp: '2026-10-17T08:00:00.000Z'
 *     InvitationForbidden:
 *       description: Invalid/expired token or inactive user.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 403
 *             error: Invalid Token
 *             message: Access Token Invalid Or Expired
 *             timestamp: '2026-10-17T08:00:00.000Z'
 *     InvitationNotFound:
 *       description: Invitation does not exist or is not visible to this user.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 404
 *             error: Invitation Not Found
 *             message: Invitation not found
 *             timestamp: '2026-10-17T08:00:00.000Z'
 *     InvitationConflict:
 *       description: Invitation is closed, a user already has a pair, or the previous connection has ended.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 409
 *             error: Invitation Conflict
 *             message: Invitation is no longer available
 *             timestamp: '2026-10-17T08:00:00.000Z'
 *     InvitationExpired:
 *       description: Invitation has expired.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 410
 *             error: Invitation Expired
 *             message: Invitation has expired
 *             timestamp: '2026-10-17T08:00:00.000Z'
 *     InvitationInternalError:
 *       description: Unexpected database or configuration failure.
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ErrorResponse'
 *           example:
 *             statusCode: 500
 *             error: Internal Server Error
 *             message: Could not process invitation
 *             timestamp: '2026-10-17T08:00:00.000Z'
 * /pair-invitations/preview:
 *   post:
 *     tags:
 *       - Pair Invitations
 *     summary: Preview an invitation
 *     description: >-
 *       Checks the code/link and both users' eligibility without creating a pair. Does not expose
 *       email, token hashes or other private-space data.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InvitationInput'
 *           examples:
 *             code:
 *               summary: Join using a code
 *               value:
 *                 code: K8P3M7Q2
 *             link:
 *               summary: Join using the token from an invite link or QR
 *               value:
 *                 linkToken: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
 *     responses:
 *       '200':
 *         description: Inviter information and expiry.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationPreviewResponse'
 *             example:
 *               statusCode: 200
 *               message: Invitation preview retrieved
 *               data:
 *                 invitationId: 550e8400-e29b-41d4-a716-446655440000
 *                 inviter:
 *                   userId: 550e8400-e29b-41d4-a716-446655440001
 *                   displayName: An
 *                 expiresAt: '2026-10-18T08:00:00.000Z'
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '400':
 *         $ref: '#/components/responses/InvitationInvalidInput'
 *       '401':
 *         $ref: '#/components/responses/InvitationUnauthorized'
 *       '403':
 *         $ref: '#/components/responses/InvitationForbidden'
 *       '404':
 *         $ref: '#/components/responses/InvitationNotFound'
 *       '409':
 *         $ref: '#/components/responses/InvitationConflict'
 *       '410':
 *         $ref: '#/components/responses/InvitationExpired'
 *       '500':
 *         $ref: '#/components/responses/InvitationInternalError'
 * /pair-invitations/accept:
 *   post:
 *     tags:
 *       - Pair Invitations
 *     summary: Accept an invitation
 *     description: >-
 *       Creates a pair and two memberships atomically. Retrying the same credential by the same
 *       acceptor returns the existing active pair; a disconnected pair cannot be restored.
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/InvitationInput'
 *           examples:
 *             code:
 *               summary: Join using a code
 *               value:
 *                 code: K8P3M7Q2
 *             link:
 *               summary: Join using the token from an invite link or QR
 *               value:
 *                 linkToken: aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
 *     responses:
 *       '200':
 *         description: Already accepted by this user; the same pair is still active.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationAcceptResponse'
 *             example:
 *               statusCode: 200
 *               message: Pair connected
 *               data:
 *                 pairId: 550e8400-e29b-41d4-a716-446655440000
 *                 status: active
 *                 timezone: Asia/Ho_Chi_Minh
 *                 anniversaryDate: null
 *                 createdAt: '2026-10-17T08:00:00.000Z'
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '201':
 *         description: A new pair was created.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationAcceptResponse'
 *             example:
 *               statusCode: 201
 *               message: Pair connected
 *               data:
 *                 pairId: 550e8400-e29b-41d4-a716-446655440000
 *                 status: active
 *                 timezone: Asia/Ho_Chi_Minh
 *                 anniversaryDate: null
 *                 createdAt: '2026-10-17T08:00:00.000Z'
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '400':
 *         $ref: '#/components/responses/InvitationInvalidInput'
 *       '401':
 *         $ref: '#/components/responses/InvitationUnauthorized'
 *       '403':
 *         $ref: '#/components/responses/InvitationForbidden'
 *       '404':
 *         $ref: '#/components/responses/InvitationNotFound'
 *       '409':
 *         $ref: '#/components/responses/InvitationConflict'
 *       '410':
 *         $ref: '#/components/responses/InvitationExpired'
 *       '500':
 *         $ref: '#/components/responses/InvitationInternalError'
 * /pair-invitations/{invitationId}:
 *   delete:
 *     tags:
 *       - Pair Invitations
 *     summary: Revoke your pending invitation
 *     description: >-
 *       Only the invitation owner may revoke it. No request body. Repeating revoke succeeds; accepted
 *       invitations cannot be revoked.
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: invitationId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *         example: 550e8400-e29b-41d4-a716-446655440000
 *     responses:
 *       '200':
 *         description: Invitation revoked; data is null.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvitationRevokeResponse'
 *             example:
 *               statusCode: 200
 *               message: Invitation revoked
 *               data: null
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '400':
 *         description: Invitation ID is not in UUID format.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 400
 *               error: Validation Failed
 *               message: Invalid invitation ID
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '401':
 *         $ref: '#/components/responses/InvitationUnauthorized'
 *       '403':
 *         $ref: '#/components/responses/InvitationForbidden'
 *       '404':
 *         $ref: '#/components/responses/InvitationNotFound'
 *       '409':
 *         description: Invitation has already been accepted.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             example:
 *               statusCode: 409
 *               error: Invitation Conflict
 *               message: Invitation is no longer pending
 *               timestamp: '2026-10-17T08:00:00.000Z'
 *       '410':
 *         $ref: '#/components/responses/InvitationExpired'
 *       '500':
 *         $ref: '#/components/responses/InvitationInternalError'
 */
router.post(
  "/preview",
  authenticateToken,
  invitationController.previewInvitation
);

router.post(
  "/accept",
  authenticateToken,
  invitationController.acceptInvitation
);

router.delete(
  "/:invitationId",
  authenticateToken,
  invitationController.revokeInvitation
);

module.exports = router;