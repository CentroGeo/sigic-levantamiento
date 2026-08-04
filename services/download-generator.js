const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const JSZip = require('jszip');
const XLSX = require('xlsx');
const {
  normalizeContribution,
  mediaExportFileName,
  mediaReferences,
  normalizeMedia,
  resolveMediaPath,
  safeFilename,
} = require('../utils/download-data');
const { createDataDictionary } = require('../utils/data-dictionary');
const { enrichContributionTerritory } = require('./territorial-enrichment');

const SUPPORTED_FORMATS = new Set(['xlsx', 'csv', 'geojson', 'gpkg']);

function normalizeFormat(value) {
  const format = String(value || 'xlsx').toLowerCase();
  if (format === 'geopackage') return 'gpkg';
  if (!SUPPORTED_FORMATS.has(format)) {
    const error = new Error('Formato de descarga no soportado');
    error.statusCode = 400;
    throw error;
  }
  return format;
}

function createGeoJson(rows) {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((row) => Number.isFinite(row.longitud) && Number.isFinite(row.latitud))
      .map((row) => {
        const { longitud, latitud, ...properties } = row;
        return {
          type: 'Feature',
          id: row.id,
          geometry: {
            type: 'Point',
            coordinates: [longitud, latitud],
          },
          properties,
        };
      }),
  };
}

function runOgr2Ogr(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    const process = spawn('ogr2ogr', [
      '-f',
      'GPKG',
      outputPath,
      inputPath,
      '-nln',
      'aportaciones',
      '-a_srs',
      'EPSG:4326',
    ]);
    let stderr = '';

    process.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    process.on('error', reject);
    process.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`No fue posible generar GeoPackage: ${stderr.trim() || `código ${code}`}`));
    });
  });
}

async function createResultFile(format, rows, tempDir) {
  const worksheet = XLSX.utils.json_to_sheet(rows);

  if (format === 'xlsx') {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Aportaciones');
    return {
      name: 'resultados.xlsx',
      data: XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }),
    };
  }

  if (format === 'csv') {
    return {
      name: 'resultados.csv',
      data: Buffer.from(`\uFEFF${XLSX.utils.sheet_to_csv(worksheet)}`, 'utf8'),
    };
  }

  const geoJson = JSON.stringify(createGeoJson(rows), null, 2);
  if (format === 'geojson') {
    return {
      name: 'aportaciones.geojson',
      data: Buffer.from(geoJson, 'utf8'),
    };
  }

  const geoJsonPath = path.join(tempDir, 'aportaciones.geojson');
  const geoPackagePath = path.join(tempDir, 'aportaciones.gpkg');
  await fsp.writeFile(geoJsonPath, geoJson);
  await runOgr2Ogr(geoJsonPath, geoPackagePath);
  return {
    name: 'aportaciones.gpkg',
    data: await fsp.readFile(geoPackagePath),
  };
}

async function addMedia(zip, contributions, uploadsRoot) {
  // Mantiene una estructura uniforme y evita colisiones prefijando el ID del aporte.
  const mediaFolder = zip.folder('multimedia');
  let included = 0;

  for (const contribution of contributions) {
    const mediaItems = normalizeMedia(contribution.media_array);
    for (let index = 0; index < mediaItems.length; index += 1) {
      const media = mediaItems[index];
      const filePath = resolveMediaPath(media.filePath, uploadsRoot);
      if (!filePath) continue;

      try {
        const stats = await fsp.stat(filePath);
        if (!stats.isFile()) continue;
        const exportName = mediaExportFileName(media, index, `aporte_${contribution.id}_`);
        mediaFolder.file(exportName, await fsp.readFile(filePath));
        included += 1;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
  return included;
}

async function generateDownload({
  contributions,
  format,
  includeMedia = true,
  projectName,
  downloadsRoot,
  uploadsRoot,
}) {
  const selectedFormat = normalizeFormat(format);
  const enrichedContributions = await Promise.all(
    contributions.map((contribution) => enrichContributionTerritory(contribution))
  );
  const normalizedRows = enrichedContributions.map((contribution) => ({
    ...normalizeContribution(contribution),
    multimedia: mediaReferences(
      contribution.media_array,
      `aporte_${contribution.id}_`
    ).join(' | '),
  }));
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'levantamiento-download-'));

  try {
    const resultFile = await createResultFile(selectedFormat, normalizedRows, tempDir);
    const zip = new JSZip();
    zip.file(resultFile.name, resultFile.data);
    const dictionaryRow = normalizedRows.reduce(
      (fields, row) => ({ ...fields, ...row }),
      {}
    );
    zip.file(
      'diccionario_datos.csv',
      createDataDictionary(
        enrichedContributions,
        dictionaryRow,
        selectedFormat
      )
    );
    if (includeMedia) await addMedia(zip, contributions, uploadsRoot);

    await fsp.mkdir(downloadsRoot, { recursive: true });
    const uniqueSuffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const fileName = `${safeFilename(projectName, 'proyecto')}_aportaciones_${uniqueSuffix}.zip`;
    const outputPath = path.resolve(downloadsRoot, fileName);
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });
    await fsp.writeFile(outputPath, zipBuffer);

    return {
      fileName,
      filePath: outputPath,
      format: selectedFormat,
      contributionCount: contributions.length,
    };
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = {
  generateDownload,
  normalizeFormat,
};
