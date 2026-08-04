const fsp = require('fs').promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const JSZip = require('jszip');
const {
  mediaExportFileName,
  mediaReferences,
  normalizeContribution,
  normalizeMedia,
  resolveMediaPath,
  safeFilename,
} = require('../utils/download-data');
const { createDataDictionary } = require('../utils/data-dictionary');
const { enrichContributionTerritory } = require('./territorial-enrichment');

const SUPPORTED_FORMATS = new Set(['geojson', 'kml', 'shapefile']);

/** Normaliza los alias admitidos para las exportaciones de un aporte individual. */
function normalizeContributionFormat(value) {
  const format = String(value || '').toLowerCase();
  const aliases = { shp: 'shapefile', shape: 'shapefile' };
  const normalized = aliases[format] || format;

  if (!SUPPORTED_FORMATS.has(normalized)) {
    const error = new Error('Formato de aporte no soportado');
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

const SHAPEFILE_NAMES = {
  proyecto_id: 'proy_id',
  fecha_levantamiento: 'f_levant',
  fecha_guardado: 'f_guardado',
  municipio_cvegeo: 'mun_cve',
  entidad_cvegeo: 'ent_cve',
  entidad_nombre: 'ent_nombre',
  institucion_nombre: 'instituc',
  ubicacion_sensible: 'ubica_sens',
  datos_usuario: 'dat_usuario',
};

/** Construye una colección GeoJSON puntual y aplica nombres de campo alternativos. */
function contributionGeoJson(row, fieldNames = {}) {
  if (!Number.isFinite(row.longitud) || !Number.isFinite(row.latitud)) {
    const error = new Error('El aporte no tiene coordenadas válidas');
    error.statusCode = 422;
    throw error;
  }

  const { longitud, latitud, ...properties } = row;
  const mappedProperties = Object.fromEntries(
    Object.entries({ ...properties, latitud, longitud }).map(([key, value]) => [
      fieldNames[key] || key,
      value,
    ])
  );
  return {
    type: 'FeatureCollection',
    name: 'aporte',
    features: [
      {
        type: 'Feature',
        id: row.id,
        geometry: {
          type: 'Point',
          coordinates: [longitud, latitud],
        },
        properties: mappedProperties,
      },
    ],
  };
}

/**
 * Produce nombres únicos de hasta diez caracteres, límite del formato DBF que
 * acompaña a un Shapefile, preservando la relación en el diccionario de datos.
 */
function uniqueShapefileNames(fields) {
  const used = new Set();
  const result = {};

  fields.forEach((field) => {
    const questionMatch = field.match(/^pregunta_([^_]+)/);
    let candidate = SHAPEFILE_NAMES[field] || (questionMatch ? `p_${questionMatch[1]}` : field);
    candidate = candidate
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 10);
    if (!candidate) candidate = 'campo';

    let unique = candidate;
    let suffix = 2;
    while (used.has(unique.toLowerCase())) {
      unique = `${candidate.slice(0, 8)}_${suffix}`.slice(0, 10);
      suffix += 1;
    }
    used.add(unique.toLowerCase());
    result[field] = unique;
  });
  return result;
}

/** Ejecuta una conversión de GDAL y propaga un error legible si esta falla. */
function runOgr2Ogr(args) {
  return new Promise((resolve, reject) => {
    const process = spawn('ogr2ogr', args);
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`No fue posible convertir el aporte: ${stderr.trim() || `código ${code}`}`));
    });
  });
}

/** Agrega al ZIP todos los archivos que componen el Shapefile generado. */
async function addDirectory(zip, directory) {
  const files = await fsp.readdir(directory);

  for (const fileName of files) {
    zip.file(fileName, await fsp.readFile(path.join(directory, fileName)));
  }
}

/** Agrega la multimedia disponible y mantiene la carpeta aun cuando esté vacía. */
async function addMedia(zip, contribution, uploadsRoot) {
  // La carpeta forma parte del contrato del ZIP, incluso si el aporte no tiene archivos.
  const mediaFolder = zip.folder('multimedia');
  const mediaItems = normalizeMedia(contribution.media_array);
  if (!mediaItems.length) return 0;

  let included = 0;

  for (let index = 0; index < mediaItems.length; index += 1) {
    const media = mediaItems[index];
    const filePath = resolveMediaPath(media.filePath, uploadsRoot);
    if (!filePath) continue;

    try {
      const stats = await fsp.stat(filePath);
      if (!stats.isFile()) continue;
      const exportName = mediaExportFileName(media, index);
      mediaFolder.file(exportName, await fsp.readFile(filePath));
      included += 1;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return included;
}

/**
 * Genera el paquete ZIP de un aporte en GeoJSON, KML o Shapefile.
 * El paquete conserva una estructura uniforme con diccionario y multimedia.
 */
async function generateContributionExport(contribution, requestedFormat, uploadsRoot) {
  const format = normalizeContributionFormat(requestedFormat);
  const enrichedContribution = await enrichContributionTerritory(contribution);
  const normalizedRow = normalizeContribution(enrichedContribution);
  normalizedRow.multimedia = mediaReferences(enrichedContribution.media_array).join(' | ');
  const shapefileNames =
    format === 'shapefile' ? uniqueShapefileNames(Object.keys(normalizedRow)) : {};
  const geoJsonObject = contributionGeoJson(
    normalizedRow,
    format === 'shapefile' ? shapefileNames : {}
  );
  const geoJson = JSON.stringify(geoJsonObject, null, 2);
  const baseName = safeFilename(`aporte_${contribution.id}`, 'aporte');
  const zip = new JSZip();
  const contributionFolder = zip.folder(baseName);
  zip.file(
    'diccionario_datos.csv',
    createDataDictionary(enrichedContribution, normalizedRow, format, shapefileNames)
  );
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'levantamiento-aporte-'));
  const inputPath = path.join(tempDir, `${baseName}.geojson`);

  try {
    await fsp.writeFile(inputPath, geoJson);

    if (format === 'geojson') {
      contributionFolder.file(`${baseName}.geojson`, Buffer.from(geoJson, 'utf8'));
    } else if (format === 'kml') {
      const outputPath = path.join(tempDir, `${baseName}.kml`);
      await runOgr2Ogr([
        '-f',
        'KML',
        outputPath,
        inputPath,
        '-nln',
        'aporte',
        '-a_srs',
        'EPSG:4326',
      ]);
      contributionFolder.file(`${baseName}.kml`, await fsp.readFile(outputPath));
    } else {
      const shapeDir = path.join(tempDir, baseName);
      await fsp.mkdir(shapeDir);
      await runOgr2Ogr([
        '-f',
        'ESRI Shapefile',
        shapeDir,
        inputPath,
        '-nln',
        baseName,
        '-a_srs',
        'EPSG:4326',
        '-lco',
        'ENCODING=UTF-8',
        '-lco',
        'RESIZE=YES',
      ]);
      await addDirectory(contributionFolder, shapeDir);
    }

    await addMedia(contributionFolder, contribution, uploadsRoot);
    return {
      fileName: `${baseName}_${format}.zip`,
      contentType: 'application/zip',
      data: await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 },
      }),
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  generateContributionExport,
  normalizeContributionFormat,
};
