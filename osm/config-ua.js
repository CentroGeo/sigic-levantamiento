// UA fijo por app (Node 12, CommonJS)
const APP_NAME = process.env.OSM_APP_NAME || 'sigic-osm-wikidata';
const APP_VER  = process.env.OSM_APP_VER  || '0.1';
const APP_INST = process.env.OSM_APP_INST || 'dev';
const CONTACT  = process.env.OSM_CONTACT  || 'psp.oarias@centrogeo.edu.mx';
const USER_AGENT = process.env.OSM_UA || `${APP_NAME}/${APP_VER} (contact:${CONTACT}; inst:${APP_INST})`;
module.exports = { USER_AGENT, CONTACT };
