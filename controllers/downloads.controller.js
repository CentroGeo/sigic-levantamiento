const { databasePool } = require('../postgres.db');
const moment = require('moment')
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { generateDownload, normalizeFormat } = require('../services/download-generator');

const downloadsController = {};
const DOWNLOAD_STATUSES = new Set(['NO REVISADO', 'APROBADO', 'RECHAZADO']);
const DOWNLOAD_PAGE_SIZE = 12;

function normalizePage(value) {
	const page = Number.parseInt(value, 10);
	return Number.isInteger(page) && page > 0 ? page : 1;
}

function downloadFileCandidates(storedPath) {
	const fileName = path.basename(storedPath);
	// Conserva compatibilidad con archivos heredados guardados antes de usar /downloads.
	return [
		path.resolve(process.cwd(), 'downloads', fileName),
		path.resolve(process.cwd(), fileName),
	];
}

async function findDownloadFile(storedPath) {
	for (const candidate of downloadFileCandidates(storedPath)) {
		try {
			const stats = await fs.promises.stat(candidate);
			if (stats.isFile()) return candidate;
		} catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	return null;
}


/**
 * Obtiene la lista de descargas de un usuario
 * @swagger
 * /downloads/user/list:
 *   post:
 *     tags: [Descargas]
 *     summary: Lista las solicitudes de descarga de un usuario
 *     description: Obtiene de forma paginada las solicitudes creadas por el usuario, filtradas por estado.
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *         description: Número de página.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, status]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Correo electrónico del usuario solicitante.
 *               status:
 *                 type: string
 *                 enum: [NO REVISADO, APROBADO, RECHAZADO]
 *                 description: Estado de las solicitudes que se desea consultar.
 *     responses:
 *       200:
 *         description: Listado obtenido correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                       description: Número de página.
 *                     limit:
 *                       type: integer
 *                       description: Número máximo de solicitudes por página.
 *                     total:
 *                       type: integer
 *                       description: Total de solicitudes encontradas.
 *                     totalPages:
 *                       type: integer
 *                       description: Total de páginas.
 *                 descargas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: Identificador de la solicitud.
 *                       nombre_descarga:
 *                         type: string
 *                         description: Nombre de la descarga.
 *                       formato:
 *                         type: string
 *                         description: Formato del archivo principal.
 *                       usuario_id:
 *                         type: string
 *                         description: Correo del usuario solicitante.
 *                       id_proyecto:
 *                         type: integer
 *                         description: Identificador del proyecto.
 *                       fecha_solicitud:
 *                         type: string
 *                         format: date-time
 *                         description: Fecha de creación de la solicitud.
 *                       status:
 *                         type: string
 *                         description: Estado de revisión de la solicitud.
 *       400:
 *         description: Correo faltante o estado no permitido.
 */
downloadsController.listUserDownload = async (req, res) => {
	try {
		const email = String(req.body.email || '').trim();
		const status = String(req.body.status || '').trim();
		if (!email) {
			return res.status(400).send({ message: "Correo electrónico faltante" });
		}
		if (!DOWNLOAD_STATUSES.has(status)) {
			return res.status(400).send({ message: "Estado de descarga inválido" });
		}

		const page = normalizePage(req.query.page);
		const limit = DOWNLOAD_PAGE_SIZE;
		const offset = (page - 1) * limit;

		const listQuery = `
			SELECT
				l.*
			FROM public.descargas as l
			WHERE l.usuario_id = $1 AND l.status = $2
			ORDER BY l.fecha_solicitud DESC
			LIMIT $3
			OFFSET $4
		`;

		const countQuery = `
			SELECT COUNT(*) AS total
			FROM public.descargas as l
			WHERE l.usuario_id = $1 AND l.status = $2
		`;

		const [{ rows: downloads }, { rows: countRows }] = await Promise.all([
			databasePool.query({
				text: listQuery,
				values: [email, status, limit, offset],
			}),
			databasePool.query({
				text: countQuery,
				values: [email, status],
			})
		]);

		const total = Number.parseInt(countRows[0].total, 10);
		const totalPages = Math.ceil(total / limit);

		return res.status(200).send({
			pagination: {
				page,
				limit,
				total,
				totalPages
			},
			descargas: downloads
		});
	} catch (error) {
		// En caso de error, devuelve un mensaje de error
		console.log(error);
		return res.status(400).send({ message: error.message });
	}
}


/**
 * Elimina una descarga de un usuario
 * @swagger
 * /downloads/user/{id}:
 *   delete:
 *     tags: [Descargas]
 *     summary: Elimina una solicitud de descarga pendiente
 *     description: Elimina una solicitud propia que aún no ha sido revisada y retira el archivo generado asociado, cuando existe.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador de la solicitud.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Correo del usuario que creó la solicitud.
 *     responses:
 *       200:
 *         description: Solicitud pendiente eliminada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: Descarga removido
 *       400:
 *         description: Correo electrónico faltante o identificador inválido.
 *       404:
 *         description: Solicitud pendiente no encontrada o perteneciente a otro usuario.
 */
downloadsController.removeUserDownload = async (req, res) => {
	try {
		if (!req.body.email) {
			return res.status(400).send({ message: "Correo electrónico faltante" });
		}

		// Elimina la descarga de la base de datos
		const { rows } = await databasePool.query({
			text: `
				DELETE FROM public.descargas
				WHERE id = $1
					AND usuario_id = $2
					AND status = 'NO REVISADO'
				RETURNING id, file_path
			`,
			values: [req.params.id, req.body.email],
		});

		if (!rows.length) {
			return res.status(404).send({ message: "Solicitud pendiente no encontrada" });
		}

		if (rows[0].file_path) {
			for (const filePath of downloadFileCandidates(rows[0].file_path)) {
				fs.promises.unlink(filePath).catch((error) => {
					if (error.code !== 'ENOENT') console.error(error);
				});
			}
		}

		// Retorna un mensaje de descarga removido
		return res.status(200).json({
			status: "Descarga removido"
		});
	} catch (error) {
		// En caso de error, devuelve un mensaje de error
		return res.status(400).send({ message: error.message });
	}
}

/**
 * @swagger
 * /downloads/user/{id}/file:
 *   get:
 *     tags: [Descargas]
 *     summary: Descarga el archivo de una solicitud aprobada
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador de la solicitud de descarga.
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: Correo del usuario que creó la solicitud.
 *     responses:
 *       200:
 *         description: Archivo ZIP aprobado.
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Correo electrónico faltante.
 *       404:
 *         description: Solicitud no encontrada o archivo no disponible.
 */
downloadsController.downloadUserFile = async (req, res) => {
	try {
		const email = req.query.email;
		if (!email) {
			return res.status(400).send({ message: "Correo electrónico faltante" });
		}

		const { rows } = await databasePool.query({
			text: `
				SELECT file_path
				FROM public.descargas
				WHERE id = $1
					AND usuario_id = $2
					AND status = 'APROBADO'
			`,
			values: [req.params.id, email],
		});

		if (!rows.length || !rows[0].file_path) {
			return res.status(404).send({ message: "Archivo aprobado no encontrado" });
		}

		const fileName = path.basename(rows[0].file_path);
		const filePath = await findDownloadFile(rows[0].file_path);
		if (!filePath) {
			return res.status(404).send({ message: "El archivo ya no está disponible" });
		}

		return res.download(filePath, fileName);
	} catch (error) {
		return res.status(400).send({ message: error.message });
	}
};

/**
 * Exporta los levantamientos de un usuario en un archivo Excel
 * @swagger
 * /downloads/user/download:
 *   post:
 *     tags: [Descargas]
 *     summary: Exporta los levantamientos de un usuario en un archivo Excel
 *     description: Exporta los levantamientos de un usuario en un archivo Excel
 *     parameters:
 *       - in: body
 *         name: idLevantamiento
 *         required: true
 *         description: ID de la descarga
 *         schema:
 *           type: integer
 *       - in: body
 *         name: userIDRequester
 *         required: true
 *         description: ID del usuario que solicitó la descarga
 *         schema:
 *           type: integer
 *       - in: body
 *         name: nameFileToExport
 *         required: true
 *         description: Nombre del archivo Excel que se va a crear
 *         schema:
 *           type: string
 *       - in: body
 *         name: descriptionFileToExport
 *         required: true
 *         description: Descripción del archivo Excel que se va a crear
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Descarga exportada
 *       400:
 *         description: Error al exportar la descarga
 * 
 */
downloadsController.userDownloadRegisters = async (req, res) => {
	console.log("exportLevantamientos")
	try {
		console.log(req.body)

		let arrIDLevantamiento = []
		let idUsuario, nombreArchivo, descripcionArchivo = null
		let statusLev = "NO REVISADO"
		let filepath = ""
		let filepathIncomplete = ""

		let fechaLevantamiento = null
		let info = {}
		let arrLevantamientosToExport = []
		let infoLev = null
		let levantamientosBook = null
		let fileNameXLSXToCreate = null
		let fileNameXLSXIncomplete = null
		let mediaArr = {}
		let rows = null
		let result = null
		let downloadsDir = "./downloads"

		if (req.body.idLevantamiento != undefined)
			arrIDLevantamiento = req.body.idLevantamiento
		if (req.body.userIDRequester != undefined)
			idUsuario = req.body.userIDRequester
		if (req.body.nameFileToExport != undefined)
			nombreArchivo = req.body.nameFileToExport
		if (req.body.descriptionFileToExport != undefined)
			descripcionArchivo = req.body.descriptionFileToExport


		fs.exists(downloadsDir, exist => {   //revisa si existe el directorio "downloads", si no, lo crea
			if (!exist) {
				return fs.mkdir(downloadsDir, { recursive: true }, error => console.log("e"))
			}
			// return cb(null, downloadsDir)
		})

		filepathIncomplete = (nombreArchivo + "_" + new Date().toLocaleString('es-MX', { timezone: 'America/Mexico_City' })).replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');
		filepath = "./downloads/" + filepathIncomplete + ".zip"

		let query2 = `
		SELECT t1.id_proyecto, t1.nombre_proyecto, to_json(array_agg(row_to_json(t1))) as levantamientos
			from (
				SELECT l.*, proys.nombre as nombre_proyecto 
				FROM levantamientos l 
				left join proyectos AS proys ON l.id_proyecto = proys.id
				WHERE l.status = 'APROBADO'	
				and l.id = ${req.body.idLevantamiento}
			) as t1
		group by t1.id_proyecto, t1.nombre_proyecto`;
		//AND l.id IN (${arrIDLevantamiento})
		const rows2 = await databasePool.query({
			text: query2
		});

		const zip = new JSZip();

		result = rows2.rows

		result.forEach(projects => {
			arrLevantamientosToExport = []
			let arrFileMedia = [];
			projects.levantamientos.forEach(levantamiento => {
				mediaArr = JSON.parse(levantamiento.media_array)

				lista_path_image = [];
				if (mediaArr != null) {
					for (let i = 0; i < mediaArr.length; i++) {


						let relativePath = ""
						let indexObject = JSON.parse(JSON.stringify(mediaArr[i]))

						if (indexObject.mimeType == "image/jpeg") {
							relativePath = String(indexObject.fileName).substring(2)
							arrFileMedia.push(relativePath)
							lista_path_image.push(relativePath.replace("uploads/levantamientos/images/", "img/"))
						}
					}
				}

				fechaLevantamiento = moment(levantamiento.fecha_levantamiento).format("DD/MM/YYYY HH:mm:ss")

				let respuestas_ficha = JSON.parse(levantamiento.respuestas_ficha)

				info = {
					Nombre_Levantamiento: levantamiento.nombre,
					Fecha: fechaLevantamiento,
					Latitud: levantamiento.latitud,
					Longitud: levantamiento.longitud,
					Nombre_Usuario: levantamiento.nombre_usuario,
					Apellidos_Usuario: levantamiento.apellido_usuario,
					Email_Usuario: levantamiento.email,
					Edad_Usuario: levantamiento.edad,
					Sexo_Usuario: levantamiento.sexo,
					Nivel_Estudios_Usuario: levantamiento.nivel_estudios,
					Idioma_Usuario: levantamiento.idioma,
					Ocupacion_Usuario: levantamiento.ocupacion,
					Mas_Datos_Usuario: levantamiento.datos_usuario,
					Categoria_Principal: levantamiento.cat_principal,
					Estado: levantamiento.estado,
					Municipio: levantamiento.municipio,
					Proyecto: levantamiento.nombre_proyecto,
					multimedia: lista_path_image.join(",")
				}

				for (const [key, pregunta] of Object.entries(respuestas_ficha)) {
					let titulo = "Preguntas/Respuestas: " + pregunta["id_pregunta"] + "\n"
					let texto_respuestas = "Preguntas/Respuestas: " + pregunta["id_pregunta"] + "\n"

					if (pregunta["tipo"] == 'ABIERTA') {
						texto_respuestas += pregunta["id_pregunta"] + ".- " + pregunta["texto"] + ". R= " + pregunta["respuesta"] + "\n";
						info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = pregunta["respuesta"]
					}

					if (pregunta["tipo"] == 'SELECCION') {
						texto_respuestas += pregunta["id_pregunta"] + ".- " + pregunta["texto"] + ". ";

						if (pregunta["respuesta"]["otro"] != null && pregunta["respuesta"]["otro"] != "" && pregunta["respuesta"]["otro"] != undefined) {
							texto_respuestas += "R= " + pregunta["respuesta"]["otro"] + "\n";
							info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = pregunta["respuesta"]["otro"]
						}
						else {
							texto_respuestas += "R= " + pregunta["respuesta"]["selected_answer"] + "\n";
							info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = pregunta["respuesta"]["selected_answer"]
						}
						if (pregunta["respuesta"]["subpregunta"] != null) { //si la pregunta tiene subpreguntas... (es un arreglo de subpreguntas) //las subpreguntas están en el objeto de respuesta

							if (Array.isArray(pregunta["respuesta"]["subpregunta"])) { //si la subpreguntas es array
								pregunta["respuesta"]["subpregunta"].forEach(subpregunta => { //itera sobre las subpreguntas (las subpeguntas pueden ser abiertas, de selección o de campos)
									if (subpregunta["tipo"] == 'ABIERTA') { //subpregunta tipo abierta
										texto_respuestas += subpregunta["id_pregunta"] + ".- " + subpregunta["texto"] + ". R= " + subpregunta["respuesta"] + "\n";
										info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = subpregunta["respuesta"]

									}
									if (subpregunta["tipo"] == 'SELECCION') {//subpregunta tipo selección
										texto_respuestas += subpregunta["id_pregunta"] + ".- " + subpregunta["texto"] + ". ";
										if (subpregunta["respuesta"]["otro"] != null && subpregunta["respuesta"]["otro"] != "") {
											texto_respuestas += "R= " + subpregunta["respuesta"]["otro"] + "\n";

											info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = subpregunta["respuesta"]["otro"]
										}
										else {
											texto_respuestas += "R= " + subpregunta["respuesta"]["selected_answer"] + "\n";
											info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = subpregunta["respuesta"]["selected_answer"]
										}
									}
									if (subpregunta["tipo"] == 'CAMPOS') {//subpregunta tipo campos
										texto_respuestas += "R= ";
										text_respuesta_question = " ";
										for (const [key_campo, respuesta_campo] of Object.entries(subpregunta["respuesta"])) {
											texto_respuestas += key_campo + ": " + respuesta_campo + ", "
											text_respuesta_question += key_campo + ": " + respuesta_campo + ", "
										}

										texto_respuestas = texto_respuestas.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea
										text_respuesta_question = text_respuesta_question.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea

										info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = text_respuesta_question
									}

								})
							}
							else { //la subpregunta no es array, es objeto (versión antigua)
								console.log("es objeto")
								if (pregunta["respuesta"]["subpregunta"]["tipo"] == 'ABIERTA') {
									texto_respuestas += pregunta["respuesta"]["subpregunta"]["id_pregunta"] + ".- " + pregunta["respuesta"]["subpregunta"]["texto"] + ". R=" + pregunta["respuesta"]["subpregunta"]["respuesta"] + "\n";
									info[pregunta["respuesta"]["subpregunta"]["id_pregunta"] + ".- " + pregunta["respuesta"]["subpregunta"]["texto"]] = pregunta["respuesta"]["subpregunta"]["respuesta"]
								}

							}

						}
					}

					if (pregunta["tipo"] == 'SELECCION_CONDICIONAL') {
						texto_respuestas += pregunta["id_pregunta"] + ".- " + pregunta["texto"] + ". ";
						texto_respuestas += "R= " + pregunta["respuesta"]["selected_answer"] + "\n";
						info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = pregunta["respuesta"]["selected_answer"]
						//pregunta condicionada
						//si existe una pregunta condicionada a la respuesta seleccionada
						if (pregunta["respuesta"]["conditional_answer"][pregunta["respuesta"]["selected_answer"]] != null && pregunta["respuesta"]["conditional_answer"][pregunta["respuesta"]["selected_answer"]] != undefined) {
							let pregunta_condicionada = pregunta["respuesta"]["conditional_answer"][pregunta["respuesta"]["selected_answer"]]
							let pregunta_id = "";
							if (pregunta_condicionada["id"] != null && pregunta_condicionada["id"] != undefined && pregunta_condicionada["id"] != "") {
								pregunta_id = pregunta_condicionada["id"]
							}
							else {
								pregunta_id = pregunta_condicionada["id_pregunta"]
							}
							texto_respuestas += pregunta_id + ".- " + pregunta_condicionada["texto"] + ". "

							if (pregunta_condicionada["tipo"] == 'ABIERTA') {
								texto_respuestas += "R= " + pregunta_condicionada["respuesta"] + "\n";
								info[pregunta_id + ".- " + pregunta_condicionada["texto"]] = pregunta_condicionada["respuesta"]
							}
							if (pregunta_condicionada["tipo"] == 'SELECCION') {
								texto_respuestas += "R= " + pregunta_condicionada["respuesta"] + "\n" //no tiene el objeto 'respuesta', es un camp ode texto
								info[pregunta_id + ".- " + pregunta_condicionada["texto"]] = pregunta_condicionada["respuesta"]

							}
							if (pregunta_condicionada["tipo"] == 'CAMPOS') {
								texto_respuestas += "R= ";
								text_respuesta_question = " ";
								for (const [key_campo, respuesta_campo] of Object.entries(pregunta_condicionada["respuesta"])) {
									texto_respuestas += key_campo + ": " + respuesta_campo + ", "
									text_respuesta_question += key_campo + ": " + respuesta_campo + ", "
								}

								texto_respuestas = texto_respuestas.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea
								text_respuesta_question = text_respuesta_question.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea
								info[pregunta_id + ".- " + pregunta_condicionada["texto"]] = text_respuesta_question
							}

						}
					}

					if (pregunta["tipo"] == 'MULTISELECCION') {
						texto_respuestas += pregunta["id_pregunta"] + ".- " + pregunta["texto"] + ". ";
						texto_respuestas += "R= ";
						info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = ''

						for (const [key_opcion, respuesta_opcion] of Object.entries(pregunta["respuesta"]["opciones"])) {
							if (respuesta_opcion == true) {
								texto_respuestas += key_opcion + ", "
								info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] += key_opcion + ", "
							}
						}
						if (pregunta["respuesta"]["otro"] != null && pregunta["respuesta"]["otro"] != undefined && pregunta["respuesta"]["otro"] != '') {
							texto_respuestas += pregunta["respuesta"]["otro"] + ", "
							info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] += pregunta["respuesta"]["otro"] + ", "
						}

						texto_respuestas = texto_respuestas.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea
						info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]].slice(0, -2) + '\n';

						if (pregunta["respuesta"]["subpregunta"] != null) { //si la pregunta tiene subpreguntas... (es un arreglo de subpreguntas) //las subpreguntas están en el objeto de respuesta

							if (Array.isArray(pregunta["respuesta"]["subpregunta"])) { //si la subpreguntas es array
								pregunta["respuesta"]["subpregunta"].forEach(subpregunta => { //itera sobre las subpreguntas (las subpeguntas pueden ser abiertas, de selección o de campos)
									if (subpregunta["tipo"] == 'ABIERTA') { //subpregunta tipo abierta
										texto_respuestas += subpregunta["id_pregunta"] + ".- " + subpregunta["texto"] + ". R= " + subpregunta["respuesta"] + "\n";
										info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = subpregunta["respuesta"]

									}
									if (subpregunta["tipo"] == 'SELECCION') {//subpregunta tipo selección
										texto_respuestas += subpregunta["id_pregunta"] + ".- " + subpregunta["texto"] + ". ";
										if (subpregunta["respuesta"]["otro"] != null && subpregunta["respuesta"]["otro"] != "") {
											texto_respuestas += "R= " + subpregunta["respuesta"]["otro"] + "\n";
											info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = subpregunta["respuesta"]["otro"]
										}
										else {
											texto_respuestas += "R= " + subpregunta["respuesta"]["selected_answer"] + "\n";
											info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = subpregunta["respuesta"]["selected_answer"]
										}
									}
									if (subpregunta["tipo"] == 'CAMPOS') {//subpregunta tipo campos
										texto_respuestas += "R= ";
										text_respuesta_question = " ";
										for (const [key_campo, respuesta_campo] of Object.entries(subpregunta["respuesta"])) {
											texto_respuestas += key_campo + ": " + respuesta_campo + ", "
											text_respuesta_question += key_campo + ": " + respuesta_campo + ", "
										}

										texto_respuestas = texto_respuestas.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea
										text_respuesta_question = text_respuesta_question.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea
										info[subpregunta["id_pregunta"] + ".- " + subpregunta["texto"]] = text_respuesta_question
									}


								})
							}
							else { //la subpregunta no es array, es objeto (versión antigua)
								console.log("es objeto")

								if (pregunta["respuesta"]["subpregunta"]["tipo"] == 'ABIERTA') {
									texto_respuestas += pregunta["respuesta"]["subpregunta"]["id_pregunta"] + ".- " + pregunta["respuesta"]["subpregunta"]["texto"] + ". R=" + pregunta["respuesta"]["subpregunta"]["respuesta"] + "\n";
									info[pregunta["respuesta"]["subpregunta"]["id_pregunta"] + ".- " + pregunta["respuesta"]["subpregunta"]["texto"]] = pregunta["respuesta"]["subpregunta"]["respuesta"]
								}

							}

						}

					}


					if (pregunta["tipo"] == 'CAMPOS') {
						texto_respuestas += pregunta["id_pregunta"] + ".- " + pregunta["texto"] + ". ";
						texto_respuestas += "R= ";
						text_respuesta_question = "";
						for (const [key_campo, respuesta_campo] of Object.entries(pregunta["respuesta"])) {
							texto_respuestas += key_campo + ": " + respuesta_campo + ", "
							text_respuesta_question += key_campo + ": " + respuesta_campo + ", "
						}

						texto_respuestas = texto_respuestas.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea					
						text_respuesta_question = text_respuesta_question.slice(0, -2) + '\n'; //reempaza la última coma por salto de línea					
						info[pregunta["id_pregunta"] + ".- " + pregunta["texto"]] = text_respuesta_question
					}
				}

				arrLevantamientosToExport.push(info);   // arrLevantamientosToExport es un array de objetos

			})

			infoLev = XLSX.utils.json_to_sheet(arrLevantamientosToExport) // envia el arreglo con los objeto json a la tabla excel
			levantamientosBook = XLSX.utils.book_new(); //genera un nuevo libro

			XLSX.utils.book_append_sheet(levantamientosBook, infoLev, "Levantamientos"); //adjunta los levantamientos en una hoja del libro excel

			//fileNameXLSXIncomplete = 'Levantamientos_Aprobados'+ projects.nombre_proyecto.replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_') + "_" + new Date().toLocaleString('es-MX', {timezone:'America/Mexico_City'}).replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');  // nombre del archivo excel
			fileNameXLSXIncomplete = 'Levantamientos_Aprobados';  // nombre del archivo excel
			fileNameXLSXToCreate = fileNameXLSXIncomplete + ".xlsx"
			let workBookBuffer = null
			workBookBuffer = XLSX.write(levantamientosBook, { bookType: 'xlsx', type: 'array' });

			let folderNameProject = projects.nombre_proyecto.replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_') + "_" + new Date().toLocaleString('es-MX', { timezone: 'America/Mexico_City' }).replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');  // nombre del archivo excel
			let folderName = zip.folder(folderNameProject); //nombre del directorio donde estarán las imagenes, dentro del zip
			folderName.file(fileNameXLSXToCreate, workBookBuffer);

			let img = folderName.folder("img");
			for (let image of arrFileMedia) {
				try {
					let fileImage = image.substring(30)
					let imageData = fs.readFileSync(image)
					img.file(fileImage, imageData);
				} catch (error) {
					console.log("fileImage " + image + " no encontado, ignorando.")
					//console.log(error)
				}
			}
		})

		const nombreArchivoZIP = filepath

		zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
			.pipe(fs.createWriteStream(nombreArchivoZIP))
			.on('finish', async function () {
				console.log("zip generado!!!!")

				let query = `
					INSERT INTO public.descargas(nombre_descarga, descripcion, usuario_id, fecha_solicitud, file_path, status)
					VALUES($1, $2, $3, $4, $5, $6)
					returning *;
				`;

				({ rows } = await databasePool.query({
					text: query,
					values: [
						nombreArchivo,
						descripcionArchivo,
						idUsuario,
						new Date(),
						filepath,
						statusLev
					]
				}).then(result => res.status(201).json(result.rows)))

			})


	} catch (error) {
		console.log(error)
		return res.status(400).send({
			message: error.message,
			error: error,
			status: 'Error'
		});
	}
}

/**
 * Lista las solicitudes de descarga disponibles para revisión.
 * 
 * @swagger
 * /downloads/reviewer/list:
 *   post:
 *     tags: [Descargas]
 *     summary: Lista las solicitudes de descarga para revisión
 *     description: Obtiene las solicitudes asociadas a proyectos propios o con permisos de administración/revisión, filtradas por estado.
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         required: false
 *         description: Número de página.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:	
 *           schema:
 *             type: object
 *             required: [email, status]
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: Correo del propietario, administrador o revisor.
 *               status:
 *                 type: string
 *                 enum: [NO REVISADO, APROBADO, RECHAZADO]
 *                 description: Estado de las solicitudes que se desea consultar.
 *     responses:
 *       200:
 *         description: Listado obtenido correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: integer
 *                       description: Número de página.
 *                     limit:
 *                       type: integer
 *                       description: Número máximo de solicitudes por página.
 *                     total:
 *                       type: integer
 *                       description: Total de solicitudes encontradas.
 *                     totalPages:
 *                       type: integer
 *                       description: Total de páginas.
 *                 descargas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: Identificador de la solicitud.
 *                       nombre_descarga:
 *                         type: string
 *                         description: Nombre de la descarga.
 *                       descripcion:
 *                         type: string
 *                         description: Descripción o uso previsto de los datos.
 *                       usuario_id:
 *                         type: string
 *                         description: Correo del usuario solicitante.
 *                       fecha_solicitud:
 *                         type: string
 *                         description: Fecha de creación de la solicitud.
 *                       file_path:
 *                         type: string
 *                         description: Nombre o ruta almacenada del archivo generado.
 *                       status:
 *                         type: string
 *                         description: Estado de revisión de la solicitud.
 *       400:
 *         description: Correo faltante o estado no permitido.
 */
downloadsController.listReviewer = async (req, res) => {
	try {
		const page = normalizePage(req.query.page);
		const limit = DOWNLOAD_PAGE_SIZE;
		const offset = (page - 1) * limit;
		const email = String(req.body.email || '').trim();
		const status = String(req.body.status || '').trim();

		if (!email)
			return res.status(400).send({ message: "Correo electrónico faltante" });
		if (!DOWNLOAD_STATUSES.has(status))
			return res.status(400).send({ message: "Estado de descarga inválido" });

		const reviewerFilter = status === 'NO REVISADO'
			? '(l.id_curador = $1 OR l.id_curador IS NULL)'
			: 'l.id_curador = $1';
		const accessFilter = `
			l.status = $2 AND (
				p.id_propietario = $1 OR (
					EXISTS (
						SELECT 1
						FROM proyectos_usuarios pu
						WHERE pu.proyecto_id = l.id_proyecto
							AND pu.correo = $1
							AND pu.rol IN ('administrar', 'revisar')
					) AND ${reviewerFilter}
				)
			)
		`;
		const query = `
			SELECT 
				l.*
			FROM public.descargas as l
			INNER JOIN proyectos p ON p.id = l.id_proyecto
			WHERE ${accessFilter}
			ORDER BY l.fecha_solicitud ASC
			LIMIT $3
			OFFSET $4
		`

		const countQuery = `
			SELECT COUNT(*) AS total
			FROM public.descargas as l
			INNER JOIN proyectos p ON p.id = l.id_proyecto
			WHERE ${accessFilter}
		`;

		const [{ rows: descargas }, { rows: countRows }] = await Promise.all([
			databasePool.query({
				text: query,
				values: [email, status, limit, offset]
			}),
			databasePool.query({
				text: countQuery,
				values: [email, status]
			})
		]);
		
		const total = Number.parseInt(countRows[0].total, 10);
		const totalPages = Math.ceil(total / limit)
	  
		return res.status(200).send({
			pagination: {
			  page,
			  limit,
			  total,
			  totalPages
			},
			descargas: descargas
		});
	  
	} catch (error) {
		return res.status(400).send({
			status: "Error",
			error: error,
			message: error.message
		});
	}
}

/**
 * Aprueba o rechaza una solicitud de descarga.
 * 
 * @swagger
 * /downloads/reviewer/status/{id}:
 *   post:
 *     tags: [Descargas]
 *     summary: Aprueba o rechaza una solicitud de descarga
 *     description: Actualiza una solicitud pendiente y registra al usuario que realizó la revisión.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador de la solicitud de descarga.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status, user_id]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [APROBADO, RECHAZADO]
 *                 description: Resultado de la revisión.
 *               es_notificado:
 *                 type: boolean
 *                 description: Indica si se realizó la notificación correspondiente.
 *               report:
 *                 type: string
 *                 description: Motivo del rechazo; es obligatorio cuando el estado es RECHAZADO.
 *               user_id:
 *                 type: string
 *                 format: email
 *                 description: Correo del propietario, administrador o revisor.
 *     responses:
 *       200:
 *         description: Solicitud actualizada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensaje de confirmación.
 *       400:
 *         description: Estado, revisor o motivo de rechazo inválido.
 *       404:
 *         description: Solicitud pendiente no encontrada o sin permisos para revisarla.
 */
downloadsController.updateStatusReviewer = async (req, res) => {
	try {
		if (!new Set(["APROBADO", "RECHAZADO"]).has(req.body.status)) {
			return res.status(400).send({ message: "Estado de descarga inválido" });
		}
		if (!req.body.user_id) {
			return res.status(400).send({ message: "ID faltante" });
		}
		if (req.body.status === "RECHAZADO" && !req.body.report) {
			return res.status(400).send({ message: "Reporte faltante" });
		}

		const values = [];
		const fields = [];
		let index = 1;
	
		values.push(req.body.status)
		fields.push(`status = $${index++}`)
	
		if(req.body.user_id){
		  values.push(req.body.user_id)
		  fields.push(`id_curador = $${index++}`)
	
		  values.push(new Date())
		  fields.push(`fecha_aceptacion = $${index++}`)
		}
	
		if(req.body.report){
		  values.push(req.body.report)
		  fields.push(`comentario_curador = $${index++}`)
		}
		
	
		if(req.body.es_notificado !== undefined){
		  values.push(req.body.es_notificado)
		  fields.push(`es_notificado = $${index++}`)
		}
	
		values.push(req.params.id)
		const downloadIdIndex = index++;
		values.push(req.body.user_id)
		const reviewerIndex = index;
	
		const query = `
		  UPDATE public.descargas
		  SET ${fields.join(", ")}
		  WHERE id = $${downloadIdIndex}
			AND status = 'NO REVISADO'
			AND EXISTS (
				SELECT 1
				FROM public.proyectos p
				WHERE p.id = descargas.id_proyecto
					AND (
						p.id_propietario = $${reviewerIndex}
						OR EXISTS (
							SELECT 1
							FROM public.proyectos_usuarios pu
							WHERE pu.proyecto_id = p.id
								AND pu.correo = $${reviewerIndex}
								AND pu.rol IN ('administrar', 'revisar')
						)
					)
			)
		  RETURNING id, status
		`
		const updateSql = {
		  text: query,
		  values: values
		};
	
		// Ejecuta la consulta de actualizaci n
		const { rows } = await databasePool.query(updateSql);
		if (!rows.length) {
			return res.status(404).send({
				message: "Solicitud pendiente no encontrada o sin permisos para revisarla"
			});
		}
	
		// Devuelve una respuesta con el estado de la operaci n
		return res.status(200).send({
		  status: "ok",
		  message: "Descarga actualizada",
		  descarga: rows[0]
		});
	  } catch (error) {
		// Devuelve una respuesta con el mensaje de error
		return res.status(400).send({ message: error.message });
	  }
};


/**
 * Obtiene las descargas de un proyecto
 * 
 * @swagger
 * /downloads/owner/downloads:
 *   post:
 *     tags: [Descargas]
 *     summary: Solicita la descarga de los aportes aprobados de un proyecto
 *     description: Genera y almacena un ZIP con resultados, diccionario de datos y multimedia para iniciar su flujo de revisión.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [project_id, user_id, project_name, format]
 *             properties:
 *               project_id:
 *                 type: integer
 *                 minimum: 1
 *                 description: Identificador del proyecto.
 *               user_id:
 *                 type: string
 *                 format: email
 *                 description: Correo del usuario solicitante.
 *               project_name:
 *                 type: string
 *                 description: Nombre del proyecto.
 *               descriptionFileToExport:
 *                 type: string
 *                 description: Uso previsto para los datos.
 *               format:
 *                 type: string
 *                 enum: [csv, gpkg, xlsx, geojson]
 *                 description: Formato del archivo principal; CSV y GeoPackage son las opciones expuestas en la interfaz.
 *               include_media:
 *                 type: boolean
 *                 default: true
 *                 description: Indica si el ZIP debe incluir los archivos multimedia.
 *     responses:
 *       201:
 *         description: Solicitud creada y archivo generado.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *       400:
 *         description: Datos incompletos o formato no soportado.
 *       422:
 *         description: El proyecto no tiene aportes aprobados.
 */
downloadsController.listOwnerDownloads = async (req, res) => {
	try {
		if (!req.body.project_id) return res.status(400).send({ message: "Id de proyecto faltante" });
		if (!req.body.user_id) return res.status(400).send({ message: "user id faltante" });
		if (!req.body.project_name) return res.status(400).send({ message: "nombre del proyecto faltante" });
		const format = normalizeFormat(req.body.format);
		const includeMedia = req.body.include_media !== false && req.body.include_media !== 'false';
		const projectId = Number(req.body.project_id);
		if (!Number.isInteger(projectId) || projectId <= 0) {
			return res.status(400).send({ message: "Id de proyecto inválido" });
		}

		const { rows: contributions } = await databasePool.query({
			text: `
				SELECT l.*, p.nombre AS nombre_proyecto
				FROM public.levantamientos l
				INNER JOIN public.proyectos p ON p.id = l.id_proyecto
				WHERE l.status = 'APROBADO'
					AND l.id_proyecto = $1
				ORDER BY l.id
			`,
			values: [projectId],
		});

		if (!contributions.length) {
			return res.status(422).send({
				message: "El proyecto no tiene aportaciones aprobadas para descargar",
			});
		}

		const generated = await generateDownload({
			contributions,
			format,
			includeMedia,
			projectName: req.body.project_name,
			downloadsRoot: path.resolve(process.cwd(), 'downloads'),
			uploadsRoot: path.resolve(process.cwd(), 'uploads'),
		});

		const { rows } = await databasePool.query({
			text: `
				INSERT INTO public.descargas(
					nombre_descarga,
					descripcion,
					usuario_id,
					fecha_solicitud,
					file_path,
					status,
					id_proyecto,
					formato
				)
				VALUES($1, $2, $3, $4, $5, $6, $7, $8)
				RETURNING *
			`,
			values: [
				req.body.project_name,
				req.body.descriptionFileToExport || null,
				req.body.user_id,
				new Date(),
				generated.fileName,
				"NO REVISADO",
				projectId,
				generated.format,
			],
		});

		return res.status(201).json(rows);

	} catch (error) {
		console.log(error)
		return res.status(error.statusCode || 400).send({
			message: error.message,
			status: 'Error'
		});
	}
}

module.exports = downloadsController;
