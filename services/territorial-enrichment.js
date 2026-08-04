const { Pool } = require('pg');

let geodataPool;

/** Crea bajo demanda una conexión limitada al catálogo geográfico configurado. */
function getGeodataPool() {
  const rawUrl = String(process.env.GEODATABASE_URL || '').trim();
  if (!rawUrl) return null;

  if (!geodataPool) {
    geodataPool = new Pool({
      connectionString: rawUrl.replace(/^postgis:\/\//, 'postgresql://'),
      max: 3,
      idleTimeoutMillis: 30000,
    });
  }
  return geodataPool;
}

/** Comprueba que las coordenadas pertenezcan al dominio geográfico de EPSG:4326. */
function validCoordinates(longitude, latitude) {
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= -180 &&
    longitude <= 180 &&
    latitude >= -90 &&
    latitude <= 90
  );
}

/** Corrige texto UTF-8 que fue interpretado previamente como Latin-1. */
function repairEncoding(value) {
  const text = String(value || '');
  return /(?:Ã.|Â.)/.test(text) ? Buffer.from(text, 'latin1').toString('utf8') : text;
}

/**
 * Completa entidad, municipio y claves INEGI mediante una consulta punto-en-polígono.
 * Si el catálogo no está configurado o no responde, conserva el aporte original.
 */
async function enrichContributionTerritory(contribution) {
  const longitude = Number(contribution.longitud);
  const latitude = Number(contribution.latitud);
  const pool = getGeodataPool();

  // El enriquecimiento es complementario: una falla de catálogo no bloquea la descarga.
  if (!pool || !validCoordinates(longitude, latitude)) return contribution;

  try {
    const { rows } = await pool.query({
      text: `
        SELECT
          "CVEGEO" AS municipio_cvegeo,
          "NOMGEO" AS municipio_nombre,
          "CVE_ENT" AS entidad_cvegeo,
          "NOM_ENT" AS entidad_nombre
        FROM public.inegi_municipios
        WHERE ST_Covers(
          geometry,
          ST_SetSRID(ST_MakePoint($1, $2), 4326)
        )
        LIMIT 1
      `,
      values: [longitude, latitude],
    });

    if (!rows.length) return contribution;
    const territory = rows[0];
    return {
      ...contribution,
      estado: repairEncoding(territory.entidad_nombre) || contribution.estado || '',
      municipio: repairEncoding(territory.municipio_nombre) || contribution.municipio || '',
      entidad_cvegeo: territory.entidad_cvegeo || contribution.entidad_cvegeo || '',
      entidad_nombre:
        repairEncoding(territory.entidad_nombre) || contribution.entidad_nombre || '',
      municipio_cvegeo:
        territory.municipio_cvegeo || contribution.municipio_cvegeo || '',
    };
  } catch (error) {
    console.error('No fue posible consultar las capas INEGI:', error.message);
    return contribution;
  }
}

module.exports = {
  enrichContributionTerritory,
  repairEncoding,
  validCoordinates,
};
