const { get, all, run } = require("../config/database");
const {
  safeFileName,
  putFile,
  keyFromUrl,
  deleteFiles,
} = require("../config/storage");

const fromRow = (row) => {
  const scan = {
    key: row.key,
    label: row.label,
    confidence: row.confidence,
    time: row.time,
    imageUrl: row.image_url,
    type: row.type,
    isRescan: Boolean(row.is_rescan),
  };
  if (row.updated_at) scan.updatedAt = row.updated_at;
  return scan;
};

const userExists = async (userId) =>
  Boolean(await get("SELECT 1 AS found FROM users WHERE user_id=?", [userId]));

/**
 * Model for scan related operations
 * @name ScanModel
 * @class
 */
class ScanModel {
  /**
   * Add a new scan for the user
   * @param {Object} file - Uploaded file
   * @param {Object} formData - Form data
   * @param {string} userId - User ID
   * @return {Promise<Object>} - Created scan object
   */
  addScan = async (file, formData, userId) => {
    if (!file) throw new Error("No image file provided");

    const { label, confidence } = formData;
    if (!label || confidence === undefined) {
      throw new Error("Missing required fields");
    }

    if (!(await userExists(userId))) {
      throw new Error("User does not exist!");
    }

    const key = crypto.randomUUID();
    const imageKey = `user_scan_images/${userId}/${key}-${safeFileName(file.filename, "scan.jpg")}`;
    const imageUrl = await putFile(imageKey, file.buffer, file.mimetype);
    const scan = {
      key,
      label,
      confidence: parseFloat(confidence),
      time: new Date().toISOString(),
      imageUrl,
      type: "skin",
      isRescan: false,
    };

    try {
      await run(
        `INSERT INTO scans (key,user_id,label,confidence,time,image_url,type,is_rescan)
         VALUES (?,?,?,?,?,?,?,?)`,
        [key, userId, scan.label, scan.confidence, scan.time, imageUrl, scan.type, 0]
      );
    } catch (error) {
      await deleteFiles([imageKey]);
      throw error;
    }

    return scan;
  };

  /**
   * Get all scans for a user with pagination
   * @param {string} userId - User ID
   * @param {number} page - Page number (default: 1)
   * @param {number} limit - Items per page (default: 10)
   * @param {string} sortOrder - Sort order: 'asc' or 'desc' (default: 'desc')
   * @return {Promise<Object>} - Paginated scans data
   */
  getAllScans = async (userId, page = 1, limit = 10, sortOrder = "desc") => {
    if (!(await userExists(userId))) {
      throw new Error("User not found");
    }

    const order = sortOrder === "asc" ? "ASC" : "DESC";
    const offset = (page - 1) * limit;

    const total = await get("SELECT COUNT(*) AS count FROM scans WHERE user_id=?", [userId]);
    const rows = await all(
      `SELECT * FROM scans WHERE user_id=? ORDER BY time ${order}, key ${order} LIMIT ? OFFSET ?`,
      [userId, limit, offset]
    );

  const totalItems = total.count;
    const totalPages = Math.ceil(totalItems / limit);

    return {
      data: rows.map(fromRow),
      pagination: {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  };

  /**
   * Update a scan
   * @param {string} userId - User ID
   * @param {string} scanId - Scan ID
   * @param {Object} updateData - Data to update (label, confidence)
   * @return {Promise<Object>} - Updated scan data
   */
  updateScan = async (userId, scanId, updateData) => {
    const fields = ["label", "confidence"].filter((field) => updateData[field] !== undefined);
    const assignments = [...fields.map((field) => `${field}=?`), "updated_at=?"];
    const result = await run(
      `UPDATE scans SET ${assignments.join(",")} WHERE key=? AND user_id=?`,
      [...fields.map((field) => updateData[field]), new Date().toISOString(), scanId, userId]
    );
    if (!result.meta.changes) {
      throw new Error("Scan not found");
    }

    const row = await get("SELECT * FROM scans WHERE key=? AND user_id=?", [scanId, userId]);
    return fromRow(row);
  };

  /**
   * Delete a specific scan and its image
   * @param {string} userId - User ID
   * @param {string} scanId - Scan ID
   * @return {Promise<void>}
   */
  deleteScan = async (userId, scanId) => {
    const row = await get("SELECT image_url FROM scans WHERE key=? AND user_id=?", [scanId, userId]);
    if (!row) {
      throw new Error("Scan not found");
    }

    await run("DELETE FROM scans WHERE key=? AND user_id=?", [scanId, userId]);

    try {
      await deleteFiles([keyFromUrl(row.image_url)]);
    } catch (error) {
      console.warn("Could not delete image from storage:", error.message);
    }
  };

  /**
   * Delete all scans (and images) for a user
   * @param {string} userId - User ID
   * @return {Promise<number>} - Number of deleted scans
   */
  deleteAllScans = async (userId) => {
    const rows = await all("SELECT image_url FROM scans WHERE user_id=?", [userId]);
    if (rows.length === 0) {
      return 0;
    }

    const result = await run("DELETE FROM scans WHERE user_id=?", [userId]);

    try {
      await deleteFiles(rows.map((row) => keyFromUrl(row.image_url)));
    } catch (error) {
      console.warn("Could not delete images from storage:", error.message);
    }

    return result.meta.changes;
  };
}

module.exports = new ScanModel();
