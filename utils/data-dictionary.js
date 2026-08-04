const { answerLabel, parseJson } = require('./download-data');

const FIELD_DESCRIPTIONS = {
  id: ['Identificador único del aporte', 'levantamiento'],
  proyecto_id: ['Identificador del proyecto', 'levantamiento'],
  proyecto: ['Nombre del proyecto', 'levantamiento'],
  nombre: ['Nombre o título del aporte', 'levantamiento'],
  fecha_levantamiento: ['Fecha de realización del aporte', 'levantamiento'],
  fecha_guardado: ['Fecha de almacenamiento del aporte', 'levantamiento'],
  usuario: ['Identificador de la persona que realizó el aporte', 'levantamiento'],
  estado: ['Nombre de la entidad federativa donde se localiza el punto', 'INEGI'],
  municipio: ['Nombre del municipio donde se localiza el punto', 'INEGI'],
  municipio_cvegeo: ['Clave geoestadística municipal de cinco caracteres', 'INEGI'],
  entidad_cvegeo: ['Clave geoestadística de la entidad federativa', 'INEGI'],
  entidad_nombre: ['Nombre de la entidad federativa', 'INEGI'],
  institucion_nombre: ['Nombre de la institución asociada', 'levantamiento'],
  latitud: ['Latitud del punto en grados decimales', 'levantamiento'],
  longitud: ['Longitud del punto en grados decimales', 'levantamiento'],
  ubicacion_sensible: ['Indica si la ubicación fue marcada como sensible', 'levantamiento'],
  datos_usuario: ['Información adicional de la persona usuaria', 'levantamiento'],
  multimedia: [
    'Rutas relativas de los archivos multimedia incluidos con el aporte',
    'levantamiento',
  ],
};

function questionDescriptions(contribution) {
  const parsed = parseJson(contribution?.respuestas_ficha, {});
  const questions = Array.isArray(parsed) ? parsed : Object.values(parsed);

  return questions.reduce((result, question, index) => {
    if (!question || typeof question !== 'object') return result;
    result[answerLabel(question, index)] = [
      question.texto || question.pregunta || question.label || `Respuesta ${index + 1}`,
      `formulario:${question.tipo || 'sin_tipo'}`,
    ];
    return result;
  }, {});
}

function fieldType(value) {
  if (typeof value === 'boolean') return 'booleano';
  if (typeof value === 'number') return Number.isInteger(value) ? 'entero' : 'decimal';
  return 'texto';
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Genera el diccionario que acompaña a cada exportación. Acepta uno o varios
 * aportes para documentar también preguntas que no estén presentes en el
 * primer registro del proyecto.
 */
function createDataDictionary(contributions, row, format, fieldNames = {}) {
  const sourceContributions = Array.isArray(contributions) ? contributions : [contributions];
  const questionFields = sourceContributions.reduce(
    (result, contribution) => ({ ...result, ...questionDescriptions(contribution) }),
    {}
  );
  const descriptions = { ...FIELD_DESCRIPTIONS, ...questionFields };
  const records = Object.entries(row).map(([field, value]) => {
    const [description, source] = descriptions[field] || [
      `Campo ${field}`,
      'levantamiento',
    ];
    return {
      campo_archivo: fieldNames[field] || field,
      campo_original: field,
      tipo: fieldType(value),
      descripcion: description,
      fuente: source,
      formato: format,
    };
  });

  if (!['csv', 'xlsx'].includes(format)) {
    records.push({
      campo_archivo: 'geometry',
      campo_original: 'geometry',
      tipo: 'Point',
      descripcion: 'Geometría puntual en longitud y latitud',
      fuente: 'levantamiento',
      formato: format,
    });
  }

  const headers = ['campo_archivo', 'campo_original', 'tipo', 'descripcion', 'fuente', 'formato'];
  const lines = [
    headers.join(','),
    ...records.map((record) => headers.map((header) => csvValue(record[header])).join(',')),
  ];
  return Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8');
}

module.exports = { createDataDictionary };
