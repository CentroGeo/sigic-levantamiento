const path = require('path');

/** Interpreta valores JSON almacenados como texto sin interrumpir la exportación. */
function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value;

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** Convierte valores compuestos en representaciones escalares aptas para archivos SIG. */
function scalarValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => scalarValue(item))
      .filter((item) => item !== '')
      .join(' | ');
  }
  return JSON.stringify(value);
}

/** Genera un nombre estable para cada respuesta del formulario dinámico. */
function answerLabel(question, index) {
  const id = question?.id_pregunta ?? question?.id ?? index + 1;
  const text = question?.texto ?? question?.pregunta ?? question?.label ?? 'respuesta';
  return `pregunta_${id}_${String(text)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()}`;
}

/** Aplana las respuestas de la ficha para incorporarlas como atributos del aporte. */
function flattenAnswers(rawAnswers) {
  const parsed = parseJson(rawAnswers, {});
  const questions = Array.isArray(parsed) ? parsed : Object.values(parsed);

  return questions.reduce((result, question, index) => {
    if (!question || typeof question !== 'object') return result;
    result[answerLabel(question, index)] = scalarValue(question.respuesta ?? question.answer ?? '');
    return result;
  }, {});
}

/** Estandariza los campos comunes y las respuestas antes de exportarlos. */
function normalizeContribution(row) {
  const userData = parseJson(row.datos_usuario, {});

  return {
    id: row.id,
    proyecto_id: row.id_proyecto,
    proyecto: row.nombre_proyecto || '',
    nombre: row.nombre || '',
    fecha_levantamiento: row.fecha_levantamiento || '',
    fecha_guardado: row.fecha_guardado || '',
    usuario: row.usuario_id || '',
    estado: row.estado || '',
    municipio: row.municipio || '',
    municipio_cvegeo: row.municipio_cvegeo || '',
    entidad_cvegeo: row.entidad_cvegeo || '',
    entidad_nombre: row.entidad_nombre || '',
    institucion_nombre: row.institucion_nombre || '',
    latitud: Number(row.latitud),
    longitud: Number(row.longitud),
    ubicacion_sensible: Boolean(row.ubicacion_sensible),
    datos_usuario: scalarValue(userData),
    ...flattenAnswers(row.respuestas_ficha),
  };
}

/** Normaliza las variantes históricas con las que se almacenó la multimedia. */
function normalizeMedia(rawMedia) {
  const parsed = parseJson(rawMedia, []);
  if (!Array.isArray(parsed)) return [];

  return parsed
    .map((item) => ({
      originalName: item?.original_name || item?.originalName || item?.file_name || item?.fileName,
      fileName: item?.file_name || item?.fileName,
      mimeType: item?.mimetype || item?.mimeType || '',
      filePath: item?.path || item?.filePath || item?.fileName || '',
    }))
    .filter((item) => item.filePath);
}

/** Construye un nombre seguro y legible para un archivo multimedia exportado. */
function mediaExportFileName(media, index, prefix = '') {
  const extension = path.extname(media.originalName || media.fileName || media.filePath || '');
  const baseName = safeFilename(
    path.basename(
      media.originalName || media.fileName || `archivo_${index + 1}`,
      extension
    ),
    `archivo_${index + 1}`
  );
  return `${prefix}${baseName}${extension}`;
}

/** Devuelve las rutas relativas que se escriben dentro del archivo de resultados. */
function mediaReferences(rawMedia, prefix = '') {
  return normalizeMedia(rawMedia).map(
    (media, index) => `multimedia/${mediaExportFileName(media, index, prefix)}`
  );
}

/** Elimina caracteres no portables para producir nombres de archivo seguros. */
function safeFilename(value, fallback = 'archivo') {
  const normalized = String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100);

  return normalized || fallback;
}

/**
 * Resuelve una referencia multimedia dentro del volumen autorizado de uploads.
 * Devuelve null ante intentos de traversal o rutas fuera del directorio permitido.
 */
function resolveMediaPath(filePath, uploadsRoot) {
  const absoluteUploadsRoot = path.resolve(uploadsRoot);
  const normalizedInput = String(filePath).replace(/\\/g, '/').replace(/^\.\//, '');
  const withoutUploadsPrefix = normalizedInput.replace(/^uploads\//, '');
  const candidate = path.resolve(absoluteUploadsRoot, withoutUploadsPrefix);

  // Impide que una ruta almacenada salga del volumen autorizado de uploads.
  if (candidate !== absoluteUploadsRoot && !candidate.startsWith(`${absoluteUploadsRoot}${path.sep}`)) {
    return null;
  }
  return candidate;
}

module.exports = {
  answerLabel,
  mediaExportFileName,
  mediaReferences,
  normalizeContribution,
  normalizeMedia,
  parseJson,
  resolveMediaPath,
  safeFilename,
};
