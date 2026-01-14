const express = require('express');
const router = express.Router();

const levantamientosController = require('../controllers/levantamientos.controller');
const Authenticator = require("../helpers/Authenticator");
const Filer = require('../helpers/Filer');

const auth = new Authenticator();
const filer = new Filer("levantamientos");

//Apis para las creación, edicion y eliminación de levantamientos
router.post("/user/list", levantamientosController.list);
router.post("/user/create", levantamientosController.create);
router.post('/user/register/v2', levantamientosController.getRegisterV2);
//router.post('/user/register', levantamientosController.getRegister);
//router.post("/user/update", auth.verifyToken, levantamientosController.update);

//Api para chat de un levantamiento
router.post("/chat/list", levantamientosController.listChat);
router.put("/chat/reviewer/:id", levantamientosController.chatReviewer);
router.put("/chat/creator/:id", levantamientosController.chatCreator);



module.exports = router;
