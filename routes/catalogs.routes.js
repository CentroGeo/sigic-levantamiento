const express = require('express');
const router = express.Router();

const miapptsilController = require('../controllers/catalogs.controller');
const Authenticator = require("../helpers/Authenticator");
const Filer = require('../helpers/Filer');

const auth = new Authenticator();
const filer = new Filer("levantamientos");

router.get('/states', miapptsilController.states);
router.get('/municipalities/:id', miapptsilController.municipalities);

module.exports = router;
