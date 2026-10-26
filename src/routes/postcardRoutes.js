const express = require("express");
const controller = require("../controllers/postcardController");
const { authenticateToken } = require("../middlewares/authMiddleware");

const router = express.Router();
router.use(authenticateToken);
router.post("/drafts", controller.create);
router.post("/realtime-ticket", controller.ticket);
router.get("/", controller.list);
router.get("/:id", controller.get);
router.delete("/:id", controller.discard);
router.post("/:id/lock", controller.lock);
router.post("/:id/unlock", controller.unlock);
router.post("/:id/send", controller.send);
router.get("/:id/image", controller.image);
module.exports = router;
