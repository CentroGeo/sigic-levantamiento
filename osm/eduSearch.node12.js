// Lógica Overpass + normalización + caché TTL (Node 12, CommonJS)
const fetch = require('node-fetch');
const { USER_AGENT, CONTACT } = require('./config-ua');

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];
const RADIUS_METERS = 5000;

// --- Cache in-memory (TTL & tamaño) ---
const CACHE_TTL_MS = parseInt(process.env.OSM_CACHE_TTL_MS || 10 * 60 * 1000, 10); // 10 min
const CACHE_MAX = parseInt(process.env.OSM_CACHE_MAX || 200, 10);
const _cache = new Map();
function _key(lat, lon) { return `${lat.toFixed(5)},${lon.toFixed(5)},r=${RADIUS_METERS}`; }
function _get(key) {
  const v = _cache.get(key);
  if (!v) return null;
  if (Date.now() - v.t > CACHE_TTL_MS) { _cache.delete(key); return null; }
  return v.items;
}
function _set(key, items) {
  if (_cache.size >= CACHE_MAX) {
    const first = _cache.keys().next().value;
    if (first) _cache.delete(first);
  }
  _cache.set(key, { t: Date.now(), items });
}
// --------------------------------------

function buildQuery(lat, lon) {
  const r = RADIUS_METERS;
  return `
[out:json][timeout:30];
(
  node["amenity"~"^(school|university|college|research_institute)$"](around:${r},${lat},${lon});
  way ["amenity"~"^(school|university|college|research_institute)$"](around:${r},${lat},${lon});
  rel ["amenity"~"^(school|university|college|research_institute)$"](around:${r},${lat},${lon});
  node["office"~"^(educational_institution|research)$"](around:${r},${lat},${lon});
  way ["office"~"^(educational_institution|research)$"](around:${r},${lat},${lon});
  rel ["office"~"^(educational_institution|research)$"](around:${r},${lat},${lon});
  node["man_made"="laboratory"](around:${r},${lat},${lon});
  way ["man_made"="laboratory"](around:${r},${lat},${lon});
  rel ["man_made"="laboratory"](around:${r},${lat},${lon});
  node["faculty"](around:${r},${lat},${lon});
  way ["faculty"](around:${r},${lat},${lon});
  rel ["faculty"](around:${r},${lat},${lon});
);
out center tags;`;
}

function pickCategory(tags) {
  if (!tags) return null;
  if (tags.amenity) return `amenity=${tags.amenity}`;
  if (tags.office) return `office=${tags.office}`;
  if (tags['man_made']) return `man_made=${tags['man_made']}`;
  if (tags.faculty) return `faculty=${tags.faculty}`;
  return null;
}

function normalize(elements) {
  return elements.map(function (e) {
    var lon = null, lat = null;
    if (e.type === 'node') { lon = e.lon; lat = e.lat; }
    else if (e.center) { lon = e.center.lon; lat = e.center.lat; }
    var tags = e.tags || {};
    return {
      osm_type: e.type,
      osm_id: e.id,
      name: tags.name || tags['name:es'] || tags['name:en'] || null,
      category: pickCategory(tags),
      qid: tags.wikidata || '',
      lon: lon, lat: lat
    };
  }).filter(function (it) { return it.lon != null && it.lat != null; });
}

function toGeoJSON(items) {
  return {
    type: 'FeatureCollection',
    features: items.map(function (it) {
      return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [it.lon, it.lat] },
        properties: {
          osm_type: it.osm_type,
          osm_id: it.osm_id,
          name: it.name,
          category: it.category,
          qid: it.qid
        }
      };
    })
  };
}

async function callOverpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent': USER_AGENT,
    'From': CONTACT,
    'Accept': 'application/json'
  };
  let lastErr;
  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const url = OVERPASS_ENDPOINTS[i];
    try {
      const res = await fetch(url, { method: 'POST', headers: headers, body: body, timeout: 30000 });
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
      const json = await res.json();
      if (!json || !json.elements) throw new Error('Respuesta sin elementos');
      return json.elements;
    } catch (err) {
      lastErr = err;
      await new Promise(function (r) { setTimeout(r, 600); });
    }
  }
  throw lastErr || new Error('Fallo Overpass');
}

async function searchEduByPoint(opts) {
  const lat = opts && typeof opts.lat === 'number' ? opts.lat : NaN;
  const lon = opts && typeof opts.lon === 'number' ? opts.lon : NaN;
  const format = opts && opts.format;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
      lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('Parámetros inválidos: lat/lon fuera de rango');
  }

  const key = _key(lat, lon);
  const cached = _get(key);
  if (cached) {
    const payload = (format === 'geojson') ? { geojson: toGeoJSON(cached) } : { items: cached };
    payload.meta = { cache: 'HIT', key, ttl_ms: CACHE_TTL_MS };
    return payload;
  }

  const items = normalize(await callOverpass(buildQuery(lat, lon)));
  _set(key, items);
  const payload = (format === 'geojson') ? { geojson: toGeoJSON(items) } : { items };
  payload.meta = { cache: 'MISS', key, ttl_ms: CACHE_TTL_MS };
  return payload;
}

module.exports = { searchEduByPoint, toGeoJSON };
