const { databasePool } = require('../postgres.db');
const moment = require('moment')
const XLSX = require('xlsx');
const fs = require('fs');
const JSZip = require('jszip');

const downloadsController = {};


downloadsController.listUserDownload = async (req, res) => {
	try {
		const { rows } = await databasePool.query({
			text: `
				SELECT 
					l.*, u.email, i.nombre as nombre_propietario, i.apellido as apellido_propietario
                FROM public.descargas as l
                LEFT join users u on l.usuario_id = u.email
                LEFT join users_info i on u.id = i.user_id
				WHERE u.email = '${req.body.email}'
			`,
		});

		return res.status(200).send({
			list: rows
		});
	} catch (error) {
		return res.status(400).send({ message: error.message });
	}
}


downloadsController.removeUserDownload = async (req, res) => {
	try {
		const { rows } = await databasePool.query({
			text: `
				DELETE FROM public.descargas
				WHERE id = ${req.params.id}
			`,
		});

		res.json({
			status: "Descarga removido"
		});
	} catch (error) {
		return res.status(400).send({ message: error.message });
	}
}


downloadsController.listUserDownload = async (req, res) => {
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
				SELECT l.*, u.email,i.nombre nombre_usuario,i.apellido apellido_usuario, i.edad, i.sexo, i.nivel_estudios, i.idioma, i.ocupacion, proys.nombre as nombre_proyecto 
				FROM levantamientos l 
				inner join users u on l.usuario_id = u.email
				inner join users_info i on u.id = i.user_id 
				LEFT JOIN proyectos AS proys ON l.id_proyecto = proys.id
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


downloadsController.listReviewer = async (req, res) => {
	try {
		const { rows } = await databasePool.query({
			text: `
				SELECT 
					l.*, u.email, i.nombre as nombre_propietario, i.apellido as apellido_propietario,
					uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador
                FROM public.descargas as l
                LEFT join users u on l.usuario_id = u.email
                LEFT join users_info i on u.id = i.user_id
				LEFT join users uc on l.id_curador = uc.email
				LEFT join users_info ic on uc.id = ic.user_id
				${req.body.category == "ADMINISTRADOR" ? "" : `where (l.status = 'NO REVISADO' or uc.email = '${req.body.email}') and u.email <> '${req.body.email}'`}
			`,
		});

		return res.status(200).send({
			list: rows
		});
	} catch (error) {
		return res.status(400).send({ message: error.message });
	}
}

downloadsController.updateStatusReviewer = async (req, res) => {
	console.log("data", req.body)
	if (!req.body.status) return res.status(400).send({ message: "Estado faltante" });
	if (!req.body.report) return res.status(400).send({ message: "Reporte faltante" });
	if (!req.body.user_id) return res.status(400).send({ message: "ID faltante" });

	try {
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

		return res.status(200).send({
			message: "descarga actualizada",
		});
	} catch (error) {
		console.log(error)
		return res.status(400).send({ message: error.message });
	}
};


downloadsController.listOwnerDownloads = async (req, res) => {
	try {
		let filepath = ""
		let filepathIncomplete = ""

		let arrFileMedia = [];
		let fechaLevantamiento = null
		let info = {}
		let arrLevantamientosToExport = []
		let infoLev = null
		let levantamientosBook = null
		let mediaArr = {}

		if (!req.body.project_id) return res.status(400).send({ message: "Id de proyecto faltante" });
		if (!req.body.user_id) return res.status(400).send({ message: "user id faltante" });
		if (!req.body.project_name) return res.status(400).send({ message: "nombre del proyecto faltante" });


		filepathIncomplete = (new Date().toLocaleString('es-MX', { timezone: 'America/Mexico_City' })).replace(/[&\/\\#, +()$~%.'":*?<>{}]/g, '_');
		filepath = req.body.project_name + "_levantamientos_aprobados_" + filepathIncomplete + ".zip"

		const { rows } = await databasePool.query({
			text: `
				SELECT l.*, u.email,i.nombre nombre_usuario,i.apellido apellido_usuario, i.edad, i.sexo, i.nivel_estudios, i.idioma, i.ocupacion, proys.nombre as nombre_proyecto 
				FROM levantamientos l 
				inner join users u on l.usuario_id = u.email
				inner join users_info i on u.id = i.user_id 
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

		zip.generateAsync({ type: 'nodebuffer' })
			.then((buffer) => {
				// Send zip as a download
				//console.log("zip generado!!!!", buffer)
				res.setHeader('Content-Type', 'application/zip');
				res.setHeader('Content-disposition', 'attachment; filename=' + filepath);
				res.end(buffer);
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
