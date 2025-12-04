const { searchEduByNameStrict } = require('../osm/overpassEduNameStrict.node12');

// Front manda bbox como: minLon,minLat,maxLon,maxLat
function parseBboxParam(bboxStr) {
  const nums = String(bboxStr || '').split(',').map(s => Number(s.trim()));
  if (nums.length !== 4 || nums.some(n => Number.isNaN(n))) return null;
  const minLon = nums[0], minLat = nums[1], maxLon = nums[2], maxLat = nums[3];
  if (minLon >= maxLon || minLat >= maxLat) return null;
  if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) return null;
  // Overpass: (minLat,minLon,maxLat,maxLon)
  return [minLat, minLon, maxLat, maxLon];
}

exports.eduByNameStrict = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ error: 'q debe tener >= 2 caracteres' });
    }

    const state = req.query.state ? String(req.query.state).trim() : '';
    // Nota: si llega bbox, el estado es opcional
    const limit = Math.min(parseInt(req.query.limit || '20', 10), 50);
    const bboxOW = req.query.bbox ? parseBboxParam(req.query.bbox) : null;

    const out = await searchEduByNameStrict({
      q,
      limit,
      state,
      bbox: bboxOW
    });

    // Headers de diagnóstico
    const meta = (out && out.meta) ? out.meta : {};
    res.set('X-Area-Plan', meta.areaPlan || '');
    res.set('X-State-ISO', meta.stateISO || '');
    res.set('X-Overpass-Url', meta.overpassUrl || '');
    if (meta.bbox) res.set('X-BBOX', String(meta.bbox.join(',')));
    if (meta.stateBBox) res.set('X-State-BBox', String(meta.stateBBox.join(',')));
    if (meta.cache) res.set('X-Cache', String(meta.cache));

    return res.status(200).json(out.geojson);
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.code === 'ABORT_ERR')) {
      return res.status(504).json({ error: 'Timeout de Overpass' });
    }
    return res.status(502).json({ error: 'Error consultando Overpass', detail: (e && e.message) ? e.message : String(e) });
  }
};
