// Controller: usa el módulo Nominatim local
const { searchEduByName } = require('../osm/nominatimSearch.node12');

exports.getEduByName = async (req, res) => {
  const q = String(req.query.q || '');
  const limit = req.query.limit;
  const wantAll = /^(1|true|yes)$/i.test(String(req.query.all || ''));
  if (!q.trim()) return res.status(400).json({ error: 'q requerido' });
  try {
    const out = await searchEduByName({ q, limit, all: wantAll });
    if (out.meta && out.meta.cache) res.set('X-Cache', out.meta.cache); // HIT/MISS
    res.json(out.geojson);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
};
