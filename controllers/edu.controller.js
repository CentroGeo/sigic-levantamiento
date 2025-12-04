// Controller Express: valida params, llama al módulo y devuelve GeoJSON
const { searchEduByPoint } = require('../osm/eduSearch.node12');

exports.getEduByPoint = async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return res.status(400).json({ error: 'lat/lon requeridos numéricos' });
  }
  try {
    const { geojson, meta } = await searchEduByPoint({ lat, lon, format: 'geojson' });
    if (meta && meta.cache) res.set('X-Cache', meta.cache); // HIT/MISS
    res.json(geojson);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
