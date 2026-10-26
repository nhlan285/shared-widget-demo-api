const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../utils/sendResponse");
const scanModel = require("../models/scanModel");
const { imageStorageEnabled } = require("../config/storage");
const { parseMultipartForm } = require("../helpers/parseMultipartForm");
const { MAX_FILE_SIZE } = require("../utils/constant");

/**
 * Scan Controller
 */
class ScanController {
  /**
   * Lấy tất cả scans của user với pagination
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - Paginated scans data
   */
  getAllScans = async (req, res) => {
    try {
      const userId = req.userId;
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 10;
      const sortOrder = req.query.sortOrder || "desc";

      // Validate pagination parameters
      if (page < 1) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Page number must be greater than 0"
        );
      }

      if (limit < 1 || limit > 100) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Limit must be between 1 and 100"
        );
      }

      if (!["asc", "desc"].includes(sortOrder)) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Sort order must be 'asc' or 'desc'"
        );
      }

      // Lấy scans từ model
      const result = await scanModel.getAllScans(
        userId,
        page,
        limit,
        sortOrder
      );

      return sendSuccessResponse(
        res,
        200,
        "Scans retrieved successfully",
        result
      );
    } catch (error) {
      console.error("Get All Scans Error:", error.message);

      if (error.message === "User not found") {
        return sendErrorResponse(
          res,
          404,
          "User Not Found",
          "User does not exist"
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

  /**
   * Thêm scan mới
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - Created scan data
   */
  addScan = async (req, res) => {
    // TEMP: creating a scan requires an image, so disable it without R2.
    if (!imageStorageEnabled()) {
      return sendErrorResponse(
        res, 503, "Feature Unavailable", "Image uploads are temporarily disabled"
      );
    }
    try {
      const userId = req.userId;

      // Parse multipart form data
      const { files, fields } = await parseMultipartForm(req);
      const file = files.file;
      const { label, confidence } = fields;

      // Validate required fields
      if (!file) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Image file is required"
        );
      }

      if (!label) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Label is required"
        );
      }

      if (confidence === undefined) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Confidence is required"
        );
      }

      // Validate confidence value
      const confidenceValue = parseFloat(confidence);
      if (
        isNaN(confidenceValue) ||
        confidenceValue < 0 ||
        confidenceValue > 1
      ) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "Confidence must be a number between 0 and 1"
        );
      }

      //   // Validate file type
      //   const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];
      //   if (!allowedMimeTypes.includes(file.mimetype)) {
      //     return sendErrorResponse(
      //       res,
      //       400,
      //       "Validation Failed",
      //       "Only JPEG and PNG images are allowed"
      //     );
      //   }

      // Validate file size (max 10MB)
      if (file.buffer.length > MAX_FILE_SIZE) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "File size must be less than 10MB"
        );
      }

      // Thêm scan mới
      const createdScan = await scanModel.addScan(
        file,
        { label, confidence: confidenceValue },
        userId
      );

      return sendSuccessResponse(
        res,
        201,
        "Scan created successfully",
        createdScan
      );
    } catch (error) {
      console.error("Add Scan Error:", error.message);

      if (
        error.message === "No image file provided" ||
        error.message === "Missing required fields" ||
        error.message === "Invalid multipart form data"
      ) {
        return sendErrorResponse(res, 400, "Validation Failed", error.message);
      }

      if (error.message === "User does not exist!") {
        return sendErrorResponse(
          res,
          404,
          "User Not Found",
          "User does not exist"
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

  /**
   * Cập nhật scan
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - Updated scan data
   */
  updateScan = async (req, res) => {
    try {
      const userId = req.userId;
      const { scanId } = req.params;
      const allowedFields = ["label", "confidence"];

      // Lọc chỉ những field được phép update
      const updateData = {};
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
          updateData[field] = req.body[field];
        }
      }

      // Kiểm tra có dữ liệu để update không
      if (Object.keys(updateData).length === 0) {
        return sendErrorResponse(
          res,
          400,
          "Validation Failed",
          "No valid fields to update"
        );
      }

      // Validate confidence nếu có
      if (updateData.confidence !== undefined) {
        const confidenceValue = parseFloat(updateData.confidence);
        if (
          isNaN(confidenceValue) ||
          confidenceValue < 0 ||
          confidenceValue > 1
        ) {
          return sendErrorResponse(
            res,
            400,
            "Validation Failed",
            "Confidence must be a number between 0 and 1"
          );
        }
        updateData.confidence = confidenceValue;
      }

      // Cập nhật scan
      const updatedScan = await scanModel.updateScan(
        userId,
        scanId,
        updateData
      );

      return sendSuccessResponse(
        res,
        200,
        "Scan updated successfully",
        updatedScan
      );
    } catch (error) {
      console.error("Update Scan Error:", error.message);

      if (error.message === "Scan not found") {
        return sendErrorResponse(
          res,
          404,
          "Scan Not Found",
          "Scan does not exist"
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

  /**
   * Xóa scan cụ thể
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - Success message
   */
  deleteScan = async (req, res) => {
    try {
      const userId = req.userId;
      const { scanId } = req.params;

      // Xóa scan
      await scanModel.deleteScan(userId, scanId);

      return sendSuccessResponse(res, 200, "Scan deleted successfully");
    } catch (error) {
      console.error("Delete Scan Error:", error.message);

      if (error.message === "Scan not found") {
        return sendErrorResponse(
          res,
          404,
          "Scan Not Found",
          "Scan does not exist"
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

  /**
   * Xóa tất cả scans của user
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - Success message with count
   */
  deleteAllScans = async (req, res) => {
    try {
      const userId = req.userId;

      // Xóa tất cả scans
      const deletedCount = await scanModel.deleteAllScans(userId);

      return sendSuccessResponse(
        res,
        200,
        `Successfully deleted ${deletedCount} scans`,
        { deletedCount }
      );
    } catch (error) {
      console.error("Delete All Scans Error:", error.message);

      return sendErrorResponse(
        res,
        500,
        "Internal Server Error",
        error.message
      );
    }
  };
}

module.exports = new ScanController();
