const express = require('express');
const router = express.Router();

const downloadsController = require('../controllers/downloads.controller');

//Apis para las creación, edicion y eliminación de descargas
router.post('/user/list', downloadsController.listUserDownload);
router.get('/user/:id/file', downloadsController.downloadUserFile);
router.delete('/user/:id', downloadsController.removeUserDownload);
router.post('/user/download', downloadsController.userDownloadRegisters);

router.post('/owner/downloads', downloadsController.listOwnerDownloads);

router.post('/reviewer/list', downloadsController.listReviewer);
router.post('/reviewer/status/:id', downloadsController.updateStatusReviewer);


module.exports = router
