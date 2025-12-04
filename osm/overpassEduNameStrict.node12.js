// Node 12 friendly
const https = require('https');
const querystring = require('querystring');
const loadEnv = require('./loadEnv'); // ruta según tu proyecto
const envVars = loadEnv(); 

console.log("envVars!!!", envVars)
console.log("OVERPASS_URLS:", process.env.OVERPASS_URLS);
console.log("CACHE_TTL_SEC:", process.env.CACHE_TTL_SEC);

// -----------------------------
// Config
// -----------------------------
const DEBUG = process.env.OSM_DEBUG_OVERPASS === '1';

const TIMEOUT_SEC = parseInt(process.env.OSM_OVERPASS_TIMEOUT || '45', 10);
const OVERPASS_URLS = String(process.env.OVERPASS_URLS || '')
  .split(/\s*,\s*/).filter(Boolean);

const DEFAULT_TTL_SEC = parseInt(process.env.CACHE_TTL_SEC || '300', 10);

// Mirror pre-ping (elige espejo saludable)
const OVERPASS_PING_TIMEOUT_MS = parseInt(process.env.OVERPASS_PING_TIMEOUT_MS || '4000', 10);
const OVERPASS_MIRROR_TTL_MS   = parseInt(process.env.OVERPASS_MIRROR_TTL_MS   || '600000', 10); // 10 min
const QL_PING = '[out:json][timeout:10]; out;';

let LAST_MIRROR_OK = null;
let LAST_MIRROR_TS = 0;

// -----------------------------
// Mini cache in-memory
// -----------------------------
const cache = new Map();
function cacheGet(key) {
  const v = cache.get(key);
  if (!v) return { hit: false };
  if (Date.now() > v.expiresAt) { cache.delete(key); return { hit: false }; }
  return { hit: true, value: v.value };
}
function cacheSet(key, value, ttlSec) {
  cache.set(key, { expiresAt: Date.now() + (ttlSec || DEFAULT_TTL_SEC) * 1000, value });
}
function cacheKey(obj) { return 'strict:' + Buffer.from(JSON.stringify(obj)).toString('base64'); }

// -----------------------------
// Estados → ISO y bbox de estado (fallback cuando no hay bbox)
// -----------------------------
const NAME_TO_ISO = (function () {
  var entries = [
    ['Aguascalientes','MX-AGU'],['Baja California','MX-BCN'],['Baja California Sur','MX-BCS'],
    ['Campeche','MX-CAM'],['Chiapas','MX-CHP'],['Chihuahua','MX-CHH'],['Ciudad de México','MX-CMX'],
    ['Coahuila','MX-COA'],['Colima','MX-COL'],['Durango','MX-DUR'],['Guanajuato','MX-GUA'],
    ['Guerrero','MX-GRO'],['Hidalgo','MX-HID'],['Jalisco','MX-JAL'],['México','MX-MEX'],['Michoacán','MX-MIC'],
    ['Morelos','MX-MOR'],['Nayarit','MX-NAY'],['Nuevo León','MX-NLE'],['Oaxaca','MX-OAX'],['Puebla','MX-PUE'],
    ['Querétaro','MX-QUE'],['Quintana Roo','MX-ROO'],['San Luis Potosí','MX-SLP'],['Sinaloa','MX-SIN'],
    ['Sonora','MX-SON'],['Tabasco','MX-TAB'],['Tamaulipas','MX-TAM'],['Tlaxcala','MX-TLA'],['Veracruz','MX-VER'],
    ['Yucatán','MX-YUC'],['Zacatecas','MX-ZAC']
  ];
  var map = new Map();
  for (var i=0;i<entries.length;i++) {
    var name = entries[i][0], iso = entries[i][1];
    map.set(name, iso);
    var key = name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
    map.set(key, iso);
  }
  return map;
})();

function nameToIso(state) {
  if (!state) return null;
  var s = String(state).trim();
  if (/^MX-[A-Z]{3}$/.test(s)) return s;
  if (/^mx-[a-z]{3}$/.test(s)) return s.toUpperCase();
  var k = s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  return NAME_TO_ISO.get(s) || NAME_TO_ISO.get(k) || null;
}

var STATE_BBOX = {
  'MX-AGU': [-102.88,21.53,-101.86,22.36],'MX-BCN':[-116.99,27.98,-112.70,32.72],'MX-BCS':[-115.25,22.45,-109.40,28.00],
  'MX-CAM': [-92.66,17.77,-89.06,20.45],'MX-CHP':[-94.30,14.53,-90.36,17.99],'MX-CHH':[-109.29,25.53,-103.08,31.90],
  'MX-COA': [-103.99,24.42,-99.86,29.88],'MX-COL':[-104.99,18.52,-103.36,19.58],'MX-CMX':[-99.364,19.049,-98.940,19.592],
  'MX-DUR': [-107.66,22.19,-102.80,26.85],'MX-GUA':[-101.89,20.00,-99.65,21.85],'MX-GRO':[-102.32,16.18,-98.05,18.89],
  'MX-HID': [-100.09,19.43,-97.88,21.51],'MX-JAL':[-105.77,18.90,-102.45,22.84],'MX-MEX':[-100.62,18.67,-98.37,20.17],
  'MX-MIC': [-103.78,18.14,-100.06,20.39],'MX-MOR':[-99.45,18.27,-98.62,19.13],'MX-NAY':[-106.71,20.60,-103.74,23.08],
  'MX-NLE': [-101.98,23.18,-99.91,27.97],'MX-OAX':[-98.70,15.62,-94.04,18.70],'MX-PUE':[-99.08,17.84,-96.84,20.84],
  'MX-QUE': [-100.67,20.03,-99.01,21.72],'MX-ROO':[-90.31,18.16,-86.71,21.61],'MX-SLP':[-102.89,21.09,-98.34,24.58],
  'MX-SIN':[-109.90,22.16,-105.17,27.42],'MX-SON':[-115.28,26.20,-108.30,32.50],'MX-TAB':[-94.30,17.10,-90.98,18.89],
  'MX-TAM': [-99.93,22.13,-97.11,26.06],'MX-TLA':[-98.66,19.18,-97.62,19.83],'MX-VER':[-98.67,17.05,-93.49,22.63],
  'MX-YUC': [-90.40,19.60,-87.30,21.75],'MX-ZAC':[-104.93,21.02,-100.80,25.11]
};

// -----------------------------
// Utilidades HTTP
// -----------------------------
function postForm(url, data, timeoutMs) {
  return new Promise((resolve, reject) => {
    const body = querystring.stringify({ data });
    const req = https.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs
    }, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const ct = (res.headers['content-type'] || '').toLowerCase();
        resolve({ status: res.statusCode, ct, body: buf });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Mirror picker con cache (ping rápido a todos hasta encontrar JSON 200)
async function pickOverpassUrl() {
  const now = Date.now();
  if (LAST_MIRROR_OK && (now - LAST_MIRROR_TS) < OVERPASS_MIRROR_TTL_MS) return LAST_MIRROR_OK;
  const list = OVERPASS_URLS.length ? OVERPASS_URLS : ['https://overpass-api.de/api/interpreter'];
  for (var i=0;i<list.length;i++) {
    const u = list[i];
    try {
      const r = await postForm(u, QL_PING, OVERPASS_PING_TIMEOUT_MS);
      const ok = r.status === 200 && r.ct.indexOf('application/json') !== -1;
      if (ok) {
        LAST_MIRROR_OK = u;
        LAST_MIRROR_TS = Date.now();
        return u;
      }
    } catch (_e) { /* sigue con el siguiente */ }
  }
  throw new Error('No hay mirrors Overpass disponibles');
}

// Envío QL al mirror elegido; si falla, intenta con los demás como respaldo
async function runOverpass(ql) {
  const primary = await pickOverpassUrl();
  const list = OVERPASS_URLS.length ? OVERPASS_URLS : ['https://overpass-api.de/api/interpreter'];
  const ordered = [primary].concat(list.filter(u => u !== primary));

  let lastErr = null;
  for (var i=0;i<ordered.length;i++) {
    const url = ordered[i];
    try {
      if (DEBUG) console.log('\n=== Overpass URL ===\n' + url + '\n=== QL ===\n' + ql + '\n=============\n');
      const r = await postForm(url, ql, TIMEOUT_SEC * 1000);
      if (r.status !== 200 || r.ct.indexOf('application/json') === -1) {
        lastErr = new Error('Overpass ' + r.status + ' ct=' + r.ct + ' @ ' + url);
        continue;
      }
      const json = JSON.parse(r.body.toString('utf8'));
      return { json: json, url: url };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Overpass failed');
}

// -----------------------------
// Regex acento-insensible
// -----------------------------
function reEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function charClass(ch) {
  // Normaliza a letra base (ej. 'Í' -> 'i' + diacrítico) y arma clase con minúsculas y MAYÚSCULAS
  var base = String(ch || '').normalize('NFD').charAt(0).toLowerCase();
  switch (base) {
    case 'a': return '[aàáâäãåªAÀÁÂÄÃÅ]';
    case 'e': return '[eèéêëEÈÉÊË]';
    case 'i': return '[iìíîïIÌÍÎÏ]';
    case 'o': return '[oòóôöõºOÒÓÔÖÕ]';
    case 'u': return '[uùúûüUÙÚÛÜ]';
    case 'n': return '[nñNÑ]';
    case 'c': return '[cçCÇ]';
    case ' ': return '[\\s._-]+'; // tolerar separadores
    default:  return reEscape(base); // resto literal seguro (ya minúscula)
  }
}
function accentInsensitivePattern(token) {
  var t = String(token || '').toLowerCase();
  var out = '';
  for (var i = 0; i < t.length; i++) out += charClass(t[i]);
  return out;
}
function tokensFromQuery(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(function (t){ return t.length >= 2; }); // permite “fi”→“física”
}
function chainRegexForKey(key, tokens) {
  // exige que TODOS los tokens aparezcan (AND) aplicando un filtro por token
  return tokens.map(function (t){
    var pat = accentInsensitivePattern(t);
    return '["' + key + '"~"' + pat + '",i]';
  }).join('');
}

// -----------------------------
// BBOX helper (defensa final)
// -----------------------------
function _normalizeBboxForOverpass(arr) {
  // Devuelve (minLat,minLon,maxLat,maxLon) corrigiendo entradas comunes
  if (!Array.isArray(arr) || arr.length !== 4) return null;
  var a = Number(arr[0]), b = Number(arr[1]), c = Number(arr[2]), d = Number(arr[3]);
  if (![a,b,c,d].every(function(n){ return Number.isFinite(n); })) return null;

  // Heurística robusta: si |a| > |b| asumimos (lon,lat,lon,lat) del front;
  // si |a| <= |b| asumimos ya está en formato Overpass (lat,lon,lat,lon).
  var looksLonLat = Math.abs(a) > Math.abs(b);

  var minLon, minLat, maxLon, maxLat;
  if (looksLonLat) {          // front -> reordena
    minLon = a; minLat = b; maxLon = c; maxLat = d;
  } else {                    // ya venía en formato Overpass
    minLat = a; minLon = b; maxLat = c; maxLon = d;
  }

  // Ordena por si vinieron invertidos
  var swLat = Math.min(minLat, maxLat), neLat = Math.max(minLat, maxLat);
  var swLon = Math.min(minLon, maxLon), neLon = Math.max(minLon, maxLon);

  if (swLat === neLat || swLon === neLon) return null; // bbox degenerado
  return [swLat, swLon, neLat, neLon];
}

// -----------------------------
// QL builder
// -----------------------------
function buildQL(opts) {
  var q = opts.q, limit = opts.limit, areaSel = opts.areaSel, areaPre = opts.areaPre, bbox = opts.bbox, nameOnly = opts.nameOnly === true;
  var scope = areaSel || (bbox ? '(' + bbox.join(',') + ')' : '');
  var tokens = tokensFromQuery(q);

  var L = [];
  L.push('[out:json][timeout:' + TIMEOUT_SEC + '];');
  if (areaPre) L.push(areaPre);
  L.push('(');
  if (!nameOnly) {
    L.push('  nwr' + scope + '["amenity"="university"]' + chainRegexForKey('name', tokens) + ';');
    L.push('  nwr' + scope + '["amenity"="college"]' + chainRegexForKey('name', tokens) + ';');
  } else {
    L.push('  nwr' + scope + chainRegexForKey('name', tokens) + ';');
    L.push('  nwr' + scope + chainRegexForKey('official_name', tokens) + ';');
    L.push('  nwr' + scope + chainRegexForKey('alt_name', tokens) + ';');
    L.push('  nwr' + scope + chainRegexForKey('short_name', tokens) + ';');
  }
  L.push(')->.res;');
  L.push('(.res;);');
  L.push('out center' + (limit ? ' ' + limit : '') + ';');
  return L.join('\n');
}

// -----------------------------
// GeoJSON
// -----------------------------
function osmToGeoJSON(elements) {
  var features = [];
  (elements || []).forEach(function (el){
    var geometry = null;
    if (el.type === 'node' && el.lat != null && el.lon != null) {
      geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
    } else if (el.center) {
      geometry = { type: 'Point', coordinates: [el.center.lon, el.center.lat] };
    }
    features.push({
      type: 'Feature',
      geometry: geometry,
      properties: {
        id: el.type + '/' + el.id,
        tags: el.tags || {},
        name: (el.tags && el.tags.name) ? el.tags.name : null
      }
    });
  });
  return { type: 'FeatureCollection', features: features };
}

// -----------------------------
// Entry point
// -----------------------------
async function searchEduByNameStrict(args) {
  var q = args.q;
  var limit = (args.limit != null) ? args.limit : 20;
  // BBOX esperado por Overpass: (minLat,minLon,maxLat,maxLon)
  // *** Normalizar bbox antes de usarlo ***
  var bbox = (Array.isArray(args.bbox) && args.bbox.length === 4) ? _normalizeBboxForOverpass(args.bbox) : null;
  var state = args.state;

  var key = cacheKey({ q: q, limit: limit, bbox: bbox, state: state });
  var hit = cacheGet(key);
  if (hit.hit) {
    var cloned = JSON.parse(JSON.stringify(hit.value));
    if (cloned.meta) cloned.meta.cache = 'HIT';
    return cloned;
  }

  var areaPlan = 'state', areaPre = null, areaSel = null, stateISO = null, stateBBox = null;
  if (bbox) {
    areaPlan = 'bbox';
  } else if (state) {
    stateISO = nameToIso(state);
    if (stateISO) {
      areaPre = 'area["ISO3166-2"="' + stateISO + '"][admin_level=4]->.a;';
      areaSel = '(area.a)';
      stateBBox = STATE_BBOX[stateISO] || null;
    }
  }

  // Primera pasada: amenity (university/college)
  var ql = buildQL({ q: q, limit: limit, areaSel: areaSel, areaPre: areaPre, bbox: bbox, nameOnly: false });
  var fetched = await runOverpass(ql);
  var elements = (fetched && fetched.json && fetched.json.elements) ? fetched.json.elements : [];

  // Fallback: name-only
  if (elements.length === 0) {
    var ql2 = buildQL({ q: q, limit: limit, areaSel: areaSel, areaPre: areaPre, bbox: bbox, nameOnly: true });
    var fetched2 = await runOverpass(ql2);
    var els2 = (fetched2 && fetched2.json && fetched2.json.elements) ? fetched2.json.elements : [];
    if (els2.length > 0) {
      fetched = fetched2;
      elements = els2;
      fetched.meta = { queryMode: 'name-only' };
    }
  }

  var geojson = osmToGeoJSON(elements);
  var value = {
    geojson: geojson,
    meta: {
      cache: 'MISS',
      overpassUrl: (fetched && fetched.url) ? fetched.url : null,
      stateISO: stateISO,
      stateBBox: stateBBox,
      areaPlan: areaPlan,
      bbox: bbox
    }
  };
  cacheSet(key, value, DEFAULT_TTL_SEC);
  return value;
}

module.exports = { searchEduByNameStrict };
