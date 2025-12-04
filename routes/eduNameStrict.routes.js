const express = require('express');
const router = express.Router();
const { eduByNameStrict } = require('../controllers/eduNameStrict.controller');

/**
 * GET /api/osm/edu/by-name/strict
 * Params:
 *   - q: string (>=2)
 *   - state: string (ISO 3166-2 o nombre, opcional si hay bbox)
 *   - limit: number (opcional, 10–50 recomendado)
 *   - bbox: string (opcional) => minLon,minLat,maxLon,maxLat
 *        Ej: bbox=-99.24,19.283,-99.12,19.38
 * Nota: si llega bbox, se prioriza plan "bbox"; si no, se usa área por estado.
 */
router.get('/api/osm/edu/by-name/strict', eduByNameStrict);

module.exports = router;
