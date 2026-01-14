const express = require('express');
const router = express.Router();

const notificationController = require('../controllers/notification.controller');

//Api para obtener si el usuario es revisor
router.get('/user/rol', notificationController.getRolUser);

//Api para notitificaciones de projectos
router.post("/projects/owner", notificationController.projectsOwnershipNotification);
router.post("/projects/owner/down", notificationController.projectsOwnershipNotificationDown);

//Api para notitificaciones de levantamientos
router.post("/raisings/owner", notificationController.raisingOwnershipNotification);
router.post("/raisings/owner/down", notificationController.raisingOwnershipNotificationDown);

//Api para notitificaciones de descargas
router.post("/downloads/owner", notificationController.downloadOwnershipNotification);
router.post("/downloads/owner/down", notificationController.downloadOwnershipNotificationDown);


router.post("/raisings/reviewer", notificationController.raisingReviewerNotifications);
router.post("/projects/reviewer", notificationController.projectsReviewerNotifications);

//router.post("/raising/deactivate", notificationController.raisingDeactivateNotifications);

module.exports = router;
