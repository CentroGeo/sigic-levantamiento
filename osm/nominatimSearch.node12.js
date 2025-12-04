const fetch = require('node-fetch');
const { USER_AGENT, CONTACT } = require('./config-ua');

var NOMINATIM_URL = process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search';
var DEFAULT_LIMIT = 10;
var ACCEPT_LANG = process.env.OSM_LANG || 'es';

// TTL compartido (10 min por defecto)
var TTL_MS = parseInt(process.env.OSM_CACHE_TTL_MS || 10 * 60 * 1000, 10);
var cache = new Map();

function cacheKey(q, limit, all) { return 'q='+q.toLowerCase().trim()+'|lim='+limit+'|all='+(all?'1':'0'); }

function pickName(rec) {
  var nd = rec.namedetails || {};
  return nd['name:es'] || nd.name || (rec.display_name ? rec.display_name.split(',')[0] : null);
}

// Obtiene clase/tipo robusto: class|category|extratags
function deriveClassType(rec) {
  var cls = rec['class'] || rec['category'] || null;
  var typ = rec['type']  || null;

  // Fallback a extratags (amenity/office/man_made)
  var xt = rec.extratags || {};
  if (!cls && (xt.amenity || xt.office || xt['man_made'])) {
    if (xt.amenity) { cls = 'amenity'; typ = xt.amenity; }
    else if (xt.office) { cls = 'office'; typ = xt.office; }
    else if (xt['man_made']) { cls = 'man_made'; typ = xt['man_made']; }
  }
  return { cls: cls, typ: typ };
}

function normalize(rec) {
  var ct = deriveClassType(rec);
  return {
    osm_type: rec.osm_type,
    osm_id: Number(rec.osm_id),
    name: pickName(rec),
    category: (ct.cls && ct.typ) ? (ct.cls + '=' + ct.typ) : null,
    qid: (rec.extratags && rec.extratags.wikidata) ? rec.extratags.wikidata : '',
    lon: parseFloat(rec.lon),
    lat: parseFloat(rec.lat)
  };
}

function isEduCategory(cat) {
  return /^(amenity=(school|university|college|research_institute)|office=(educational_institution|research)|man_made=laboratory)$/.test(cat || '');
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

async function searchEduByName(opts) {
  var q = (opts && typeof opts.q === 'string') ? opts.q : '';
  if (!q || !q.trim()) throw new Error('Parámetro q requerido');

  var limit = opts && opts.limit != null ? parseInt(opts.limit, 10) : DEFAULT_LIMIT;
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_LIMIT;
  if (limit > 50) limit = 50;

  var all = !!(opts && opts.all);
  var k = cacheKey(q, limit, all);
  var c = cache.get(k);
  if (c && (Date.now() - c.t) < TTL_MS) {
    return { geojson: toGeoJSON(c.items), meta: { cache: 'HIT', ttl_ms: TTL_MS } };
  }

  var params = new URLSearchParams({
    format: 'jsonv2',
    q: q,
    limit: String(limit),
    addressdetails: '0',
    namedetails: '1',
    extratags: '1',
    'accept-language': ACCEPT_LANG
  });
  if (process.env.OSM_NOMINATIM_COUNTRIES) params.set('countrycodes', process.env.OSM_NOMINATIM_COUNTRIES);

  var res = await fetch(NOMINATIM_URL + '?' + params.toString(), {
    headers: { 'User-Agent': USER_AGENT, 'From': CONTACT, 'Accept': 'application/json' },
    timeout: 30000
  });
  if (!res.ok) throw new Error('Nominatim HTTP ' + res.status);
  var json = await res.json();

  var itemsRaw = json.map(normalize);
  var items = all ? itemsRaw : itemsRaw.filter(function (it) { return isEduCategory(it.category); });

  cache.set(k, { t: Date.now(), items: items });
  return { geojson: toGeoJSON(items), meta: { cache: 'MISS', ttl_ms: TTL_MS } };
}

module.exports = { searchEduByName };
