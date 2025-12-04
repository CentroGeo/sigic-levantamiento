const express = require('express');
const router = express.Router();

const notificationController = require('../controllers/notification.controller');

router.post("/downloads/owner", notificationController.downloadOwnershipNotification);
router.post("/raisings/owner", notificationController.raisingOwnershipNotification);
router.post("/projects/owner", notificationController.projectsOwnershipNotification);


router.post("/raisings/reviewer", levantamientosController.raisingReviewerNotifications);
router.post("/projects/reviewer", projectsController.projectsReviewerNotifications);

module.exports = router;
