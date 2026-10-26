const {
  safeFileName,
  putFile,
  keyFromUrl,
  deleteFiles,
  imageStorageEnabled,
} = require("../config/storage");
const {
  sendSuccessResponse,
  sendErrorResponse,
} = require("../utils/sendResponse");
const { getUserById, updateUser } = require("../models/userModel");
const { parseMultipartForm } = require("../helpers/parseMultipartForm");
const { validateDisplayName } = require("../utils/validators");
const { MAX_FILE_SIZE } = require("../utils/constant");

/**
 * User Controller
 */
class UserController {
  /**
   * Lấy thông tin user hiện tại
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - User information
   */
  getUserInfo = async (req, res) => {
    try {
      const userId = req.userId; // Từ middleware authentication

      // Lấy thông tin user từ database
      const userInfo = await getUserById(userId);

      // Loại bỏ các thông tin nhạy cảm
      const { password, ...safeUserInfo } = userInfo;

      return sendSuccessResponse(
        res,
        200,
        "User information retrieved successfully",
        { userInfo: safeUserInfo }
      );
    } catch (error) {
      console.error("Get User Info Error:", error.message);

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
   * Upload image to R2 and update user profile
   * @param {Object} file - Uploaded file
   * @param {Object} formData - Form data
   * @param {string} userId - User ID
   * @return {Promise<Object>} - Updated user information
   */
  uploadImage = async (file, formData, userId) => {
    if (!file) throw new Error("No image file provided");

    const { displayName } = formData;
    if (displayName !== undefined && !validateDisplayName(displayName)) {
      throw new Error("Invalid displayName: must be a non-empty string");
    }

    const previousUser = await getUserById(userId);

    // File path với timestamp để tránh trùng tên
    const imagePath = `profile_pictures/${userId}/${Date.now()}-${safeFileName(
      file.filename,
      "profile.jpg"
    )}`;

    const publicUrl = await putFile(imagePath, file.buffer, file.mimetype);

    // Chuẩn bị dữ liệu update
    const updateData = {
      profilePic: publicUrl,
      updatedAt: new Date().toISOString(),
    };
    if (displayName !== undefined) updateData.displayName = displayName.trim();

    await updateUser(userId, updateData);

    // Xoá ảnh đại diện cũ trên R2 (bỏ qua ảnh ngoài như ui-avatars.com)
    try {
      await deleteFiles([keyFromUrl(previousUser.profilePic)]);
    } catch (error) {
      console.warn("Could not delete old profile picture:", error.message);
    }

    return {
      Success: "Profile updated successfully",
      data: {
        displayName: updateData.displayName ?? previousUser.displayName,
        profilePic: publicUrl,
      },
    };
  };

  /**
   * Cập nhật thông tin user - hỗ trợ cả JSON và multipart form data
   * @param {Object} req - Express request object
   * @param {Object} res - Express response object
   * @return {Object} - Updated user information
   */
  updateUserInfo = async (req, res) => {
    try {
      const userId = req.userId; // Từ middleware authentication

      // Kiểm tra content type để xử lý multipart form hoặc JSON
      const contentType = req.headers["content-type"] || "";
      const isMultipart = contentType.includes("multipart/form-data");

      if (isMultipart) {
        // TEMP: keep the upload implementation below for when R2 is restored.
        if (!imageStorageEnabled()) {
          return sendErrorResponse(
            res, 503, "Feature Unavailable", "Image uploads are temporarily disabled"
          );
        }
        // Xử lý multipart form data với file upload
        const { files, fields } = await parseMultipartForm(req);

        if (!files.file) {
          return sendErrorResponse(
            res,
            400,
            "Validation Failed",
            "Profile picture file is required for multipart upload"
          );
        }

        const uploadedFile = files.file;

        // // Validate file type
        // const allowedMimeTypes = ["image/jpeg", "image/jpg", "image/png"];
        // if (!allowedMimeTypes.includes(uploadedFile.mimetype)) {
        //   return sendErrorResponse(
        //     res,
        //     400,
        //     "Validation Failed",
        //     "Only JPEG and PNG images are allowed"
        //   );
        // }

        // Validate file size (max 10MB)
        if (uploadedFile.buffer.length > MAX_FILE_SIZE) {
          return sendErrorResponse(
            res,
            400,
            "Validation Failed",
            "File size must be less than 10MB"
          );
        }

        const imageData = await this.uploadImage(uploadedFile, fields, userId);

        return sendSuccessResponse(
          res,
          200,
          "Profile updated successfully",
          imageData
        );
      } else {
        // Xử lý JSON data (không có file upload)
        const allowedFields = ["displayName"];

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

        if (!validateDisplayName(updateData.displayName)) {
          return sendErrorResponse(
            res, 400, "Validation Failed", "Display name must be a non-empty string"
          );
        }
        updateData.displayName = updateData.displayName.trim();

        updateData.updatedAt = new Date().toISOString();

        // Cập nhật thông tin user
        await updateUser(userId, updateData);

        // Lấy thông tin user đã được cập nhật
        const updatedUserInfo = await getUserById(userId);
        const { password, ...safeUserInfo } = updatedUserInfo;

        return sendSuccessResponse(
          res,
          200,
          "User information updated successfully",
          { userInfo: safeUserInfo }
        );
      }
    } catch (error) {
      console.error("Update User Info Error:", error.message);

      if (error.message === "User not found") {
        return sendErrorResponse(
          res,
          404,
          "User Not Found",
          "User does not exist"
        );
      }

      if (
        error.message.includes("Missing required fields") ||
        error.message.includes("Invalid") ||
        error.message.includes("No image file provided")
      ) {
        return sendErrorResponse(res, 400, "Validation Failed", error.message);
      }

      return sendErrorResponse(
        res,
        500,
        "Internal Server Error",
        error.message
      );
    }
  };
}

module.exports = new UserController();
