const { databasePool } = require('../postgres.db');
const moment = require('moment')
const XLSX = require('xlsx');
const fs = require('fs');
const JSZip = require('jszip');

const downloadsController = {};


/**
 * Obtiene la lista de descargas de un usuario
 * @swagger
 * /downloads/user/list:
 *   post:
 *     tags: [Descargas]
 *     summary: Obtiene la lista de descargas de un usuario
 *     description: Obtiene la lista de descargas de un usuario
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del usuario
 *     requestBody:
 *       required: true
 *       content:	
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string	
 *                 description: Correo electr&oacute;nico del usuario	
 *               page:
 *                 type: integer
 *                 description: P gina actual
 *               limit:
 *                 type: integer
 *                 description: L mite de descargas por p gina
 *     responses:
 *       200:
 *         description: OK
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
 *                       description: P gina actual
 *                     limit:
 *                       type: integer
 *                       description: L mite de descargas por p gina
 *                     total:
 *                       type: integer
 *                       description: Total de descargas
 *                     totalPages:
 *                       type: integer
 *                       description: Total de p ginas
 *                 descargas:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID de la descarga
 *                       usuario_id:
 *                         type: string
 *                         description: Correo electr nico del usuario que realiz la descarga
 *                       proyecto_id:
 *                         type: integer
 *                         description: ID del proyecto al que se realiz la descarga
 *                       status:
 *                         type: string
 *                         description: Estado de la descarga
 */
downloadsController.listUserDownload = async (req, res) => {
	try {
		// Obtiene la lista de descargas de un usuario
		const page = parseInt(req.query.page, 12) || 1;
		const limit = 12;
		const offset = (page - 1) * limit;

		const { rows } = await databasePool.query({
			text: `
				SELECT
					l.*
				FROM public.descargas as l
				WHERE l.usuario_id = '${req.body.email}' and l.status = '${req.body.status}'
				LIMIT  $1
				OFFSET $2
			`,
			values: [limit, offset]
		});

		const countQuery = `
			SELECT COUNT(*) AS total
			FROM public.descargas as l
			WHERE l.usuario_id = '${req.body.email}' and l.status = '${req.body.status}'
		`;

		const [{ rows: downloads }, { rows: countRows }] = await Promise.all([
			databasePool.query({ text: query, values: [limit, offset] }),
			databasePool.query(countQuery)
		]);

		const total = parseInt(countRows[0].total, 12);
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
		return res.status(400).send({ message: error.message });
	}
}


/**
 * Elimina una descarga de un usuario
 * @swagger
 * /downloads/user/{id}:
 *   delete:
 *     tags: [Descargas]
 *     summary: Elimina una descarga de un usuario
 *     description: Elimina una descarga de un usuario
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la descarga
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: ID de la descarga	
 *               email:
 *                 type: string
 *                 description: Correo electr&oacute;nico del usuario
 *     responses:
 *       200:
 *         description: Descarga removido
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Estado de la operaci n
 */
downloadsController.removeUserDownload = async (req, res) => {
	try {
		// Elimina la descarga de la base de datos
		const { rows } = await databasePool.query({
			text: `
				DELETE FROM public.descargas
				WHERE id = ${req.params.id}
			`,
		});

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
 * Lists the downloads of a user with a certain status
 * 
 * @swagger
 * /downloads/reviewer/list:
 *   post:
 *     tags: [Descargas]
 *     summary: Lists the downloads of a user with a certain status
 *     description: Lists the downloads of a user with a certain status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID of the user
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         required: false
 *         description: Number of downloads per page
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:	
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: Email of the user
 *               status:
 *                 type: string
 *                 description: Status of the downloads
 *     responses:
 *       200:
 *         description: OK
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
 *                       description: Page number
 *                     limit:
 *                       type: integer
 *                       description: Number of downloads per page
 *                     total:
 *                       type: integer
 *                       description: Total number of downloads
 *                     totalPages:
 *                       type: integer
 *                       description: Total number of pages
 *                 downloads:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID of the download
 *                       nombre:
 *                         type: string
 *                         description: Name of the download
 *                       descripcion:
 *                         type: string
 *                         description: Description of the download
 *                       usuario_id:
 *                         type: string
 *                         description: ID of the user who made the download
 *                       fecha_solicitud:
 *                         type: string
 *                         description: Date when the download was made
 *                       file_path:
 *                         type: string
 *                         description: Path of the downloaded file
 *                       status:
 *                         type: string
 *                         description: Status of the download
 */
downloadsController.listReviewer = async (req, res) => {
	try {
		const page = parseInt(req.query.page, 12) || 1;
		const limit = 12;
		const offset = (page - 1) * limit;
		
		if (!req.body.email)
			return res.status(400).send({ message: "Correo electrónico faltante" });
	
		const query = `
			SELECT 
				l.*
			FROM public.descargas as l
			inner join proyectos_usuarios pu on pu.proyecto_id = l.id_proyecto
			WHERE (pu.correo='${req.body.email}' and pu.rol IN ('administrar', 'revisar')) and l.status = '${req.body.status}' and ${req.body.status == 'SIN EVALUAR' ? `(l.id_curador = '${req.body.email}' OR l.id_curador is null)`: `l.id_curador = '${req.body.email}'`}
			LIMIT  $1
			OFFSET $2
		`

		const countQuery = `
			SELECT COUNT(*) AS total
			FROM public.descargas as l
			inner join proyectos_usuarios pu on pu.proyecto_id = l.id_proyecto
			WHERE (pu.correo='${req.body.email}' and pu.rol IN ('administrar', 'revisar')) and l.status = '${req.body.status}' and ${req.body.status == 'SIN EVALUAR' ? `(l.id_curador = '${req.body.email}' OR l.id_curador is null)`: `l.id_curador = '${req.body.email}'`}
		`;

		const [{ rows: descargas }, { rows: countRows }] = await Promise.all([
			databasePool.query({ text: query, values: [limit, offset] }),
			databasePool.query(countQuery)
		]);
		
		const total = parseInt(countRows[0].total, 12);
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
 * Actualiza el estado de una descarga a EN REVISIÓN y notifica al curador
 * 
 * @swagger
 * /downloads/reviewer/status/{id}:
 *   put:
 *     tags: [Descargas]
 *     summary: Actualiza el estado de una descarga a EN REVISIÓN y notifica al curador
 *     description: Actualiza el estado de una descarga a EN REVISIÓN y notifica al curador
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID de la descarga
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string
 *                 description: Estado de la descarga
 *               report:
 *                 type: string
 *                 description: Reporte del curador
 *               user_id:
 *                 type: integer
 *                 description: ID del curador
 *     responses:
 *       200:
 *         description: Descarga actualizada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensaje de respuesta
 */
downloadsController.updateStatusReviewer = async (req, res) => {
	// Verifica si se proporcion  el estado de la descarga
	if (!req.body.status) return res.status(400).send({ message: "Estado faltante" });

	// Verifica si se proporcion  el reporte del curador
	if (!req.body.report) return res.status(400).send({ message: "Reporte faltante" });

	// Verifica si se proporcion  el ID del curador
	if (!req.body.user_id) return res.status(400).send({ message: "ID faltante" });

	// Verifica si se proporcion  el ID de la descarga
	if (!req.params.id) return res.status(400).send({ message: "ID faltante" });

	try {
		// Actualiza el estado de la descarga a EN REVISIÓN y notifica al curador
		const updateSql = {
			text: `
				UPDATE public.descargas
				SET status=$1, id_curador=$2, fecha_aceptacion=$3, comentario_curador=$4, es_notificado=true
				WHERE id=$5 returning *
			`,
			values: [
				req.body.status,
				req.body.user_id,
				new Date(),
				req.body.report,
				req.params.id,
			]
		};

		const { rows } = await databasePool.query(updateSql);

		// Retorna un mensaje de descarga actualizada
		return res.status(200).send({
			status: "ok",
			message: "descarga actualizada"
		});
	} catch (error) {
		console.log(error)
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
 *     summary: Obtiene las descargas de un usuario
 *     description: Obtiene las descargas de un usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project_id:
 *                 type: integer
 *                 description: ID del proyecto
 *               user_id:
 *                 type: string
 *                 description: ID del usuario
 *               project_name:
 *                 type: string
 *                 description: Nombre del proyecto
 *               descriptionFileToExport:
 *                 type: string
 *                 description: Descripci&oacute;n del archivo
 *     responses:
 *       200:
 *         description: Descargas obtenidas
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   description: Mensaje de respuesta
 */
downloadsController.listOwnerDownloads = async (req, res) => {
	try {
		if (!req.body.project_id) return res.status(400).send({ message: "Id de proyecto faltante" });
		if (!req.body.user_id) return res.status(400).send({ message: "user id faltante" });
		if (!req.body.project_name) return res.status(400).send({ message: "nombre del proyecto faltante" });

		let statusLev = "NO REVISADO"
		let idUsuario = req.body.user_id
		let nombreArchivo = req.body.project_name
		let descripcionArchivo = req.body.descriptionFileToExport
		let idProyecto = req.body.project_id
		let filepath = ""
		let filepathIncomplete = ""
		let arrFileMedia = [];
		let fechaLevantamiento = null
		let info = {}
		let arrLevantamientosToExport = []
		let infoLev = null
		let levantamientosBook = null
		let mediaArr = {}



		filepathIncomplete = (new Date().toLocaleString('es-MX', { timezone: 'America/Mexico_City' })).replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');
		filepath = req.body.project_name + "_levantamientos_aprobados_" + filepathIncomplete + ".zip"

		const { rows } = await databasePool.query({
			text: `
				SELECT l.*, proys.nombre as nombre_proyecto 
				FROM levantamientos l 
				LEFT JOIN proyectos AS proys ON l.id_proyecto = proys.id
				WHERE l.status = 'APROBADO'
				AND l.id_proyecto = ${req.body.project_id}
			`
		});

		rows.forEach(levantamiento => {
			mediaArr = JSON.parse(levantamiento.media_array)
			if (mediaArr != null) {

				for (let i = 0; i < mediaArr.length; i++) {

					let relativePath = ""
					let indexObject = JSON.parse(JSON.stringify(mediaArr[i]))

					if (indexObject.mimeType == "image/jpeg") {
						relativePath = String(indexObject.fileName).substring(2)
						arrFileMedia.push(relativePath)
					}
				}
			}

			fechaLevantamiento = moment(levantamiento.fecha_levantamiento).format("DD/MM/YYYY HH:mm:ss")

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
				Proyecto: levantamiento.nombre_proyecto,
				Respuestas: levantamiento.respuestas_ficha,
			}

			arrLevantamientosToExport.push(info);   // arrLevantamientosToExport es un array de objetos

		})

		// CREACION DEL XLSX
		infoLev = XLSX.utils.json_to_sheet(arrLevantamientosToExport) // envia el arreglo con los objeto json a la tabla excel
		levantamientosBook = XLSX.utils.book_new(); //genera un nuevo libro

		XLSX.utils.book_append_sheet(levantamientosBook, infoLev, "Levantamientos"); //adjunta los levantamientos en una hoja del libro excel

		let fileNameXLSXIncomplete = 'Levantamientos_Aprobados' + "_" + new Date().toLocaleString('es-MX', { timezone: 'America/Mexico_City' }).replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');  // nombre del archivo excel
		let fileNameXLSXToCreate = fileNameXLSXIncomplete + ".xlsx"
		let workBookBuffer = null
		workBookBuffer = XLSX.write(levantamientosBook, { bookType: 'xlsx', type: 'array' });

		// CREACIÓN DEL ZIP
		const zip = new JSZip();
		zip.file(fileNameXLSXToCreate, workBookBuffer);
		const img = zip.folder("img") //nombre del directorio donde estarán las imagenes, dentro del zip

		for (let image of arrFileMedia) {
			try {
				let fileImage = image.substring(30)
				let imageData = fs.readFileSync(image)
				img.file(fileImage, imageData)
			} catch (error) {
				console.log("fileImage " + image + " no encontado, ignorando.")
			}
		}

		zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true })
			.pipe(fs.createWriteStream(filepath))
			.on('finish', async function () {
				console.log("zip generado!!!!")

				let query = `
					INSERT INTO public.descargas(nombre_descarga, descripcion, usuario_id, fecha_solicitud, file_path, status, id_proyecto)
					VALUES($1, $2, $3, $4, $5, $6, $7)
					returning *;
				`;

				const { rows } = await databasePool.query({
					text: query,
					values: [
					  nombreArchivo,
					  descripcionArchivo,
					  idUsuario,
					  new Date(),
					  filepath,
					  statusLev,
					  idProyecto
					]
				});
				
				return res.status(201).json(rows);

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

module.exports = downloadsController;
