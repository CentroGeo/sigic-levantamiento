// Route Express: GET /api/osm/edu?lat&lon
const express = require('express');
const { getEduByPoint } = require('../controllers/edu.controller');
const router = express.Router();

router.get('/api/osm/edu', getEduByPoint);

module.exports = router;
