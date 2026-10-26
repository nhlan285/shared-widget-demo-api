const express = require("express");
const router = express.Router();
const scanController = require("../controllers/scanController");
const { authenticateToken } = require("../middlewares/authMiddleware");

/**
 * @swagger
 * /scan-service/scans:
 *   get:
 *     tags: [Scan Management]
 *     summary: Get all scans for current user
 *     description: Retrieve paginated list of user's scan records
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 10
 *         description: Items per page
 *       - in: query
 *         name: sortOrder
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order by timestamp
 *     responses:
 *       200:
 *         description: Scans retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/PaginatedResponse'
 *             example:
 *               statusCode: 200
 *               message: "Scans retrieved successfully"
 *               data:
 *                 data:
 *                   - key: "scan_doc_id_123"
 *                     label: "Acne"
 *                     confidence: 0.85
 *                     time: "2023-12-01T10:00:00.000Z"
 *                     imageUrl: "https://shared-widget-be.example.workers.dev/files/user_scan_images/2b1f.../scan1.jpg"
 *                     type: "skin"
 *                     isRescan: false
 *                 pagination:
 *                   currentPage: 1
 *                   totalPages: 2
 *                   totalItems: 15
 *                   itemsPerPage: 10
 *                   hasNextPage: true
 *                   hasPrevPage: false
 *               timestamp: "2023-12-01T10:00:00.000Z"
 *       400:
 *         description: Invalid pagination parameters
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
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
router.get("/scans", authenticateToken, scanController.getAllScans);

/**
 * @swagger
 * /scan-service/scans:
 *   post:
 *     tags: [Scan Management]
 *     summary: Upload and create new scan
 *     description: Upload a scan image with diagnosis label and confidence score
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             $ref: '#/components/schemas/ScanUpload'
 *           encoding:
 *             file:
 *               contentType: image/jpeg, image/png
 *     responses:
 *       201:
 *         description: Scan created successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Scan'
 *             example:
 *               statusCode: 201
 *               message: "Scan created successfully"
 *               data:
 *                 key: "scan_doc_id_123"
 *                 label: "Acne"
 *                 confidence: 0.85
 *                 time: "2023-12-01T10:00:00.000Z"
 *                 imageUrl: "https://shared-widget-be.example.workers.dev/files/user_scan_images/2b1f.../scan_image.jpg"
 *                 type: "skin"
 *                 isRescan: false
 *               timestamp: "2023-12-01T10:00:00.000Z"
 *       400:
 *         description: Missing required fields or invalid file
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missing_file:
 *                 value:
 *                   statusCode: 400
 *                   error: "Validation Failed"
 *                   message: "Image file is required"
 *                   timestamp: "2023-12-01T10:00:00.000Z"
 *               invalid_confidence:
 *                 value:
 *                   statusCode: 400
 *                   error: "Validation Failed"
 *                   message: "Confidence must be a number between 0 and 1"
 *                   timestamp: "2023-12-01T10:00:00.000Z"
 *               invalid_file_type:
 *                 value:
 *                   statusCode: 400
 *                   error: "Validation Failed"
 *                   message: "Only JPEG and PNG images are allowed"
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
router.post("/scans", authenticateToken, scanController.addScan);

/**
 * @swagger
 * /scan-service/scans/{scanId}:
 *   put:
 *     tags: [Scan Management]
 *     summary: Update specific scan
 *     description: Update scan information by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: scanId
 *         required: true
 *         schema:
 *           type: string
 *         description: Scan ID to update
 *         example: "scan_doc_id_123"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               label:
 *                 type: string
 *                 description: Updated scan label
 *               confidence:
 *                 type: number
 *                 minimum: 0
 *                 maximum: 1
 *                 description: Updated confidence score
 *           example:
 *             label: "Updated Acne"
 *             confidence: 0.92
 *     responses:
 *       200:
 *         description: Scan updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               allOf:
 *                 - $ref: '#/components/schemas/SuccessResponse'
 *                 - type: object
 *                   properties:
 *                     data:
 *                       $ref: '#/components/schemas/Scan'
 *             example:
 *               statusCode: 200
 *               message: "Scan updated successfully"
 *               data:
 *                 key: "scan_doc_id_123"
 *                 label: "Updated Acne"
 *                 confidence: 0.92
 *                 time: "2023-12-01T10:00:00.000Z"
 *                 imageUrl: "https://shared-widget-be.example.workers.dev/files/user_scan_images/2b1f.../scan_image.jpg"
 *                 type: "skin"
 *                 isRescan: false
 *                 updatedAt: "2023-12-01T12:00:00.000Z"
 *               timestamp: "2023-12-01T12:00:00.000Z"
 *       400:
 *         description: Validation failed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         description: Unauthorized - missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Scan not found
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
router.put("/scans/:scanId", authenticateToken, scanController.updateScan);

/**
 * @swagger
 * /scan-service/scans/{scanId}:
 *   delete:
 *     tags: [Scan Management]
 *     summary: Delete specific scan
 *     description: Delete a specific scan record by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: scanId
 *         required: true
 *         schema:
 *           type: string
 *         description: Scan ID to delete
 *         example: "scan_doc_id_123"
 *     responses:
 *       200:
 *         description: Scan deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/SuccessResponse'
 *             example:
 *               statusCode: 200
 *               message: "Scan deleted successfully"
 *               timestamp: "2023-12-01T10:00:00.000Z"
 *       401:
 *         description: Unauthorized - missing or invalid token
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       404:
 *         description: Scan not found
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
router.delete("/scans/:scanId", authenticateToken, scanController.deleteScan);

/**
 * @swagger
 * /scan-service/scans:
 *   delete:
 *     tags: [Scan Management]
 *     summary: Delete all scans for current user
 *     description: Delete all scan records for the authenticated user
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: All scans deleted successfully
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
 *                         deletedCount:
 *                           type: integer
 *                           description: Number of deleted scans
 *             example:
 *               statusCode: 200
 *               message: "Successfully deleted 5 scans"
 *               data:
 *                 deletedCount: 5
 *               timestamp: "2023-12-01T10:00:00.000Z"
 *       401:
 *         description: Unauthorized - missing or invalid token
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
router.delete("/scans", authenticateToken, scanController.deleteAllScans);

module.exports = router;
