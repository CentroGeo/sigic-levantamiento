const express = require('express');
const router = express.Router();
const {getEduByName} = require('../controllers/eduName.controller');

// GET /api/osm/edu/by-name?q=<texto>&limit=10[&all=1]
router.get('/api/osm/edu/by-name', getEduByName);

module.exports = router;
