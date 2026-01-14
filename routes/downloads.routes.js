const express = require('express');
const router = express.Router();

const downloadsController = require('../controllers/downloads.controller');

//Apis para las creación, edicion y eliminación de descargas
router.post('/user/list', downloadsController.listUserDownload);
router.delete('/user/:id', downloadsController.removeUserDownload);
router.post('/user/download', downloadsController.userDownloadRegisters);


router.post('/reviewer/list', downloadsController.listReviewer);
router.post('/reviewer/status/:id', downloadsController.updateStatusReviewer);

router.post('/owner/downloads', downloadsController.listOwnerDownloads);

module.exports = router