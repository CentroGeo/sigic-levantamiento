const { databasePool } = require("../postgres.db");
const wellknown = require("wellknown");

//import { stringify } from "wellknown/wellknown.js";
const fs = require("fs");
const path = require("path");

const exif = require("exiftool");
const turf = require("@turf/turf");
const circle = require("@turf/circle");
const appRoot = require("app-root-path");
const { Query } = require("pg");
const https = require("https");
const moment = require("moment");
const im = require("imagemagick");

const levantamientosController = {};



/*********** Sección API levantamientos  **********/

levantamientosController.create = async (req, res) => {

  console.log("***********************");
  console.log("crear levantamiento");
  console.log(req.body);
  let sql_insert = "";
  let json_respuestas = null;
  let array_multimedia = [];
  let isFromGallery = false; //por default
  let in_situ = true; //por default

  try {
    if (req.body.fuente == "web") {
      //si se mandó el id de proyecto (es opcional)
      isFromGallery = true;
      in_situ = false;
    } else {
      //viene de app
      console.log("viene de app");
      if (req.body.isFromGallery != null) {
        //si se mandó el id de proyecto (es opcional)
        isFromGallery = req.body.isFromGallery;
      }

      if (req.body.in_situ != null) {
        //si se mandó el id de proyecto (es opcional)
        in_situ = req.body.in_situ;
      }
    }

    let tiene_ficha = false;

    if (req.body.respuestas) {
      console.log("hay respuestas");
      //itera sobre el objeto de respuestas
      Object.entries(req.body.respuestas).forEach(
        ([id_pregunta, respuesta]) => {
          if (
            respuesta["is_audio"] != undefined &&
            respuesta["is_audio"] != null &&
            respuesta["is_audio"] == true
          ) {
            let url_audio =
              "./uploads/levantamientos/audio/" + respuesta["audioFile"];
            respuesta["audioFile"] = url_audio;
          }
        }
      );

      console.log(req.body.respuestas);
      json_respuestas = req.body.respuestas;

      tiene_ficha = true;
    } else {
      console.log("no hay respuestas");
      tiene_ficha = false;
      json_respuestas = null;
    }

    let estado = "";
    let municipio = "";
    let localidad = "";

    try {
      const queryResultMunicipio = await databasePool.query({
        text: `SELECT ent.entidad_cvegeo, ent.entidad_nombre,mun.municipio_nombre,mun.municipio_cvegeo 
					   FROM dim_municipio mun
					   INNER JOIN dim_entidad ent on mun.entidad_cvegeo = ent.entidad_cvegeo
					   WHERE ST_Intersects( mun.municipio_geom_4326 , ST_SetSRID(ST_MakePoint($2,$1),4326 )) limit 1;`,
        values: [req.body.latitud, req.body.longitud]
      });

      if (
        queryResultMunicipio["rows"] != null &&
        queryResultMunicipio["rows"] != undefined
      ) {
        if (queryResultMunicipio["rows"].length > 0) {
          estado = queryResultMunicipio.rows[0].entidad_nombre;
          municipio = queryResultMunicipio.rows[0].municipio_nombre;
          console.log("estado: ", estado);
          console.log("municipio: ", municipio);
        } else {
          console.log("no se encontró estado y municipio");
        }
      }
    } catch (error) {
      console.log("Error tratando de consultar municipio");
      console.log(error);
    }

    try {
      const queryResultLocalidad = await databasePool.query({
        text: `select localidad_urbana_nombre
					   from dim_localidad_urbana
					   WHERE ST_Intersects( localidad_urbana_geom_4326 , ST_SetSRID(ST_MakePoint($2,$1),4326 )) limit 1;`,
        values: [req.body.latitud, req.body.longitud]
      });

      if (
        queryResultLocalidad["rows"] != null &&
        queryResultLocalidad["rows"] != undefined
      ) {
        if (queryResultLocalidad["rows"].length > 0) {
          localidad = queryResultLocalidad.rows[0].localidad_urbana_nombre;
          console.log("localidad:", localidad);
        } else {
          console.log("No se encontró localidad");
        }
      }
    } catch (error) {
      console.log("Error tratando de consultar localidad");
      console.log(error);
    }

    //--correccion fecha de 12 hrs dsde mac y iOS
    let fecha_levantamiento = req.body.fecha_levantamiento;
    //console.log(fecha_levantamiento<)

    if (
      req.body.fecha_levantamiento.includes("a.m.") ||
      req.body.fecha_levantamiento.includes("p.m.")
    ) {
      console.log("formato de 12 horas!!!!! convertir a 24"); //puede venir de mac o iOS
      try {
        fecha_levantamiento = moment(
          req.body.fecha_levantamiento,
          "DD-MM-YYYY, h:m:s A"
        ).format("DD/MM/YYYY, HH:mm:ss");

        let dateLevan = new Date(fecha_levantamiento);
        
        if (fecha_levantamiento == "Fecha inválida") {
          fecha_levantamiento = new Date();
        }

        if (dateLevan == "Invalid Date") {
          fecha_levantamiento = new Date();
        }

      } catch (error) {
        console.log("Error al converto fecha de 12 horas");
        console.log(error);
        fecha_levantamiento = new Date();
      }
    }
    //--------

    let default_status = "NO REVISADO";
    try {
      if (req.body.revision == false) {
        default_status = "SIN EVALUAR";
      }
    } catch (error) {
      default_status = "NO REVISADO";
    }

    console.log("REQ BODY", req.body)
    const { rows } = await databasePool.query({
      text: `INSERT INTO public.levantamientos(
                usuario_id, 
                nombre,
                fecha_levantamiento, 
                fecha_guardado,
                fuente, 
                latitud, 
                longitud, 
                status, 
                tiene_ficha, 
                geom, 
                id_proyecto, 
                respuestas_ficha,
                datos_usuario, 
                media_array, 
                ubicacion_sensible, 
                estado, 
                municipio, 
                localidad, 
                isfromgallery, 
                insitu, 
                ocultar_ficha, 
                entidad_cvegeo, 
                entidad_nombre, 
                institucion_nombre
              )
                VALUES(
                  $1, 
                  $2, 
                  $3, 
                  $4, 
                  $5, 
                  $6,
                  $7,
                  $8, 
                  $9, 
                  ST_SetSRID(ST_MakePoint($7, $6), 4326), 
                  $10, 
                  $11,
                  $12, 
                  $13, 
                  $14, 
                  $15, 
                  $16, 
                  $17, 
                  $18, 
                  $19, 
                  $20, 
                  $21, 
                  $22, 
                  $23
                )
                returning *`,
      values: [
        req.body.id_usuario,
        req.body.titulo,
        fecha_levantamiento,
        new Date(),
        req.body.fuente,
        req.body.latitud,
        req.body.longitud,
        default_status,
        tiene_ficha,
        req.body.id_proyecto,
        json_respuestas,
        req.body.datos_usuario,
        JSON.stringify([]),
        req.body.ubicacion_sensible,
        estado,
        municipio,
        localidad,
        isFromGallery,
        in_situ,
        req.body.ocultar_ficha,
        req.body.datos_institucion.entidad_cvegeo,
        req.body.datos_institucion.entidad_nombre,
        req.body.datos_institucion.institucion_nombre
      ]
    });

    let levantamiento_id;
    
    if (rows[0]) {
      console.log("se guardo");
      levantamiento_id = rows[0].id;

      return res.status(200).send({
        levantamiento_id: levantamiento_id,
        status: "ok",
        message: "Levantamiento guardado"
      });
    }
  } catch (error) {
    console.log("Hubo un error al guardar el levantamiento:");
    console.log(error);
    return res.status(400).send({
      status: "Error",
      message: error.message,
      error: error
    });
  }
};


/**
 * @swagger
 * /levantamientos/register:
 *   get:
 *     tags: [Levantamientos]
 *     summary: Obtener la ficha de un proyecto
 *     description: Obtener la ficha de un proyecto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_project:
 *                 type: integer  
 *                 description: Identificador del proyecto
 *               id_user:
 *                 type: integer  
 *                 description: Identificador del usuario
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 answers:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       key:
 *                         type: string
 *                         description: Clave de la respuesta
 *                       value:
 *                         type: string
 *                         description: Valor de la respuesta
 *                 levantamientos:
 *                   type: boolean
 *                   description: Indica si el proyecto tiene un levantamiento aprobado
 */
levantamientosController.getRegister = async (req, res) => {
  try {
    // Obtiene la ficha del proyecto
    const { rows } = await databasePool.query({
      text: `SELECT ficha_proyecto::json
                   FROM proyectos
                   WHERE id = $1 and ficha_proyecto is not null
                `,
      values: [req.body.id_project]
    });

    // Verifica si existe un levantamiento aprobado para el proyecto
    const exist = await databasePool.query({
      text: `
            SELECT EXISTS(
              SELECT 1 FROM levantamientos
              WHERE id_proyecto = $1 and status = 'APROBADO'
            ) as levantamientos
            `,
      values: [req.body.id_project]
    });

    let respuestas = [];

    console.log(rows);
    console.log(rows.length);
    if (rows.length > 0) {
      // Convierte la ficha del proyecto en un array de objetos
      Object.entries(rows[0]["ficha_proyecto"]).forEach(([key, value]) => {
        respuestas.push(value);
      });
    } else {
      // Si no existe la ficha, devuelve un array vacio
    }

    return res.status(200).send({
      //answers: rows[0]["respuestas_ficha"]
      answers: respuestas,
      //levantamientos: exist.rows[0].levantamientos
      levantamientos: exist.rows[0].levantamientos ? true : false
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send({ message: error.message });
  }
};

levantamientosController.getRegisterV2 = async (req, res) => {
  try {
    const { rows } = await databasePool.query({
      text: `SELECT respuestas_ficha::json, l.media_array as path_media_folder, l.nombre 
				   FROM levantamientos l 
				   WHERE id = $1 and respuestas_ficha is not null
					`,
      values: [req.body.id_levantamiento]
    });

    let respuestas = [];

    console.log(rows);
    console.log(rows.length);
    if (rows.length > 0) {
      Object.entries(rows[0]["respuestas_ficha"]).forEach(([key, value]) => {
        respuestas.push(value);
      });

    } else {
    }

    return res.status(200).send({
      //answers: rows[0]["respuestas_ficha"]
      answers: respuestas,
      path_media_folder: rows.length > 0 ? rows[0].path_media_folder : null, 
      title: rows.length > 0 ? rows[0].nombre: null
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send({ message: error.message });
  }
};

/**
 * List the projects of a user
 * @swagger
 * /levantamientos/user/list:
 *   post:
 *     tags: [Levantamientos]
 *     summary: List the projects of a user
 *     description: List the projects of a user
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Number of projects per page
 *       - in: body
 *         name: email
 *         required: true
 *         description: Email of the user
 *       - in: body
 *         name: status
 *         required: true
 *         description: Status of the projects
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
 *                       description: Number of projects per page
 *                     total:
 *                       type: integer
 *                       description: Total number of projects
 *                     totalPages:
 *                       type: integer
 *                       description: Total number of pages
 *                 levantamientos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID of the project
 *                       nombre:
 *                         type: string
 *                         description: Name of the project
 *                       path_media_folder:
 *                         type: string
 *                         description: Path of the media folder of the project
 */
levantamientosController.listUser = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 12) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electr nico faltante" });
  
    let query = `
      SELECT 
        l.*, l.nombre as title, media_array as path_media_folder
      FROM levantamientos l
      WHERE l.usuario_id = '${req.body.email}' and l.status = '${req.body.status}'
      LIMIT  $1
      OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM levantamientos l
      WHERE l.usuario_id = '${req.body.email}' and l.status = '${req.body.status}'
    `;
    
    const [{ rows: levantamientos }, { rows: countRows }] = await Promise.all([
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
      levantamientos: levantamientos
    });

  } catch (error) {
    console.log(error);
    return res.status(400).send({
      status: "Error",
      error: error,
      message: error.message
    });
  }
};

levantamientosController.listChat = async (req, res) => {
  await databasePool
    .query({
      text: `
			SELECT l.*
      FROM public.levantamientos_mensajes as l
			where levantamiento_id = ${req.body.id}
			order by fecha_hora asc
		`
    })
    .then(result => res.status(201).json(result.rows))
    .catch(error => res.status(400).send(error));
};


/**
 * Actualiza el estado de un levantamiento a EN REVISIÓN y notifica al curador
 * @swagger
 * /levantamientos/chat/reviewer/{id}:
 *   put:
 *     tags: [Levantamientos]
 *     summary: Actualiza el estado de un levantamiento a EN REVISIÓN y notifica al curador
 *     description: Actualiza el estado de un levantamiento a EN REVISIÓN y notifica al curador
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del levantamiento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               report:
 *                 type: string
 *                 description: Reporte del curador
 *               user_id:
 *                 type: integer
 *                 description: ID del curador
 *     responses:
 *       200:
 *         description: Levantamiento actualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Estado del levantamiento
 */
/* Actualiza el estado de un levantamiento a EN REVISIÓN y notifica al curador */
levantamientosController.chatReviewer = async (req, res) => {
  // Verifica si se proporcion  el reporte del curador
  if (!req.body.report)
    return res.status(400).send({ message: "Reporte faltante" });

  // Verifica si se proporcion  el ID del curador
  if (!req.body.user_id)
    return res.status(400).send({ message: "ID faltante" });

  try {
    // Inserta el mensaje del curador en la tabla de mensajes
    const insert_message = await databasePool.query({
      text: `
        /* Inserta el mensaje del curador en la tabla de mensajes */
        insert into 
          public.levantamientos_mensajes(
            levantamiento_id, 
            fecha_hora, 
            texto, 
            usuario_id
          )
        values($1, $2, $3, $4)
      `,
      values: [
        req.params.id, 
        new Date(), 
        req.body.report, 
        req.body.user_id
      ]
    });

    // Actualiza el estado del levantamiento a EN REVISIÓN y notifica al curador
    const updateSql = {
      text: `
        /* Actualiza el estado del levantamiento a EN REVISIÓN y notifica al curador */
        UPDATE public.levantamientos
        SET status='EN REVISIÓN', id_curador=$1, fecha_aceptacion=$2, en_pausa=true, es_notificado=true
        WHERE id=$3 returning *
      `,
      values: [
        req.body.user_id, 
        new Date(), 
        req.params.id
      ]
    };

    const { rows } = await databasePool.query(updateSql);

    return res.status(200).send({
      status: "ok",
      message: "levantamiento actualizado"
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send({ message: error.message });
  }
}

/**
 * Actualiza el estado de un levantamiento a EN PAUSA y notifica al curador
 * @swagger
 * /levantamientos/chat/creator/{id}:
 *   put:
 *     tags: [Levantamientos]
 *     summary: Actualiza el estado de un levantamiento a EN PAUSA y notifica al curador
 *     description: Actualiza el estado de un levantamiento a EN PAUSA y notifica al curador
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del levantamiento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:  
 *           schema:
 *             type: object
 *             properties:
 *               report:
 *                 type: string
 *                 description: Reporte del curador
 *               user_id:
 *                 type: integer
 *                 description: ID del curador
 *     responses:
 *       200:
 *         description: Levantamiento actualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Estado del levantamiento
 */
levantamientosController.chatCreator = async (req, res) => {
  if (!req.body.report) {
    return res.status(400).send({ message: "Reporte faltante" });
  }

  if (!req.body.user_id) {
    return res.status(400).send({ message: "ID faltante" });
  }

  try {
    // Inserta un mensaje en la tabla levantamientos_mensajes
    const insert_message = await databasePool.query({
      text: `
				INSERT INTO 
          public.levantamientos_mensajes(
            levantamiento_id, 
            fecha_hora, 
            texto, 
            usuario_id
          )
				VALUES($1, $2, $3, $4)
			`,
      values: [req.params.id, new Date(), req.body.report, req.body.user_id]
    });

    // Actualiza el estado del levantamiento a EN PAUSA y notifica al curador
    const updateSql = {
      text: `
				UPDATE public.levantamientos
				SET fecha_aceptacion=$1, en_pausa=false, curador_notificado=true
				WHERE id=$2 returning *
			`,
      values: [new Date(), req.params.id]
    };

    const { rows } = await databasePool.query(updateSql);

    return res.status(200).send({
      status: "ok",
      message: "levantamiento actualizado"
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send({ message: error.message });
  }
}

/**
 * List the projects that a user can review
 * @swagger
 * /levantamientos/reviewer/list:
 *   post:
 *     tags: [Levantamientos]
 *     summary: List the projects that a user can review
 *     description: List the projects that a user can review
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         description: Page number
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Number of projects per page
 *       - in: body
 *         name: email
 *         required: true
 *         description: Email of the user
 *       - in: body
 *         name: status
 *         required: true
 *         description: Status of the projects
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
 *                       description: Number of projects per page
 *                     total:
 *                       type: integer
 *                       description: Total number of projects
 *                     totalPages:
 *                       type: integer
 *                       description: Total number of pages
 *                 levantamientos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID of the project
 *                       title:
 *                         type: string
 *                         description: Title of the project
 *                       path_media_folder:
 *                         type: string
 *                         description: Path of the project media folder
 */
levantamientosController.listReviewer = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 12) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    const query = `
      SELECT 
        l.*, l.nombre as title, media_array as path_media_folder
      FROM levantamientos l
      INNER join proyectos_usuarios pu on pu.proyecto_id = l.id_proyecto
      WHERE (pu.correo='${req.body.email}' and pu.rol IN ('administrar', 'revisar')) and l.status = '${req.body.status}' and ${req.body.status == 'SIN EVALUAR' ? `(l.id_curador = '${req.body.email}' OR l.id_curador is null)`: `l.id_curador = '${req.body.email}'`}
      LIMIT  $1
      OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM levantamientos l
      inner join proyectos_usuarios pu on pu.proyecto_id = l.id_proyecto
      WHERE (pu.correo='${req.body.email}' and pu.rol IN ('administrar', 'revisar')) and l.status = '${req.body.status}' and ${req.body.status == 'SIN EVALUAR' ? `(l.id_curador = '${req.body.email}' OR l.id_curador is null)`: `l.id_curador = '${req.body.email}'`}
    `;

    const [{ rows: levantamientos }, { rows: countRows }] = await Promise.all([
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
      levantamientos: levantamientos
    });

  } catch (error) {
    console.log(error);
    return res.status(400).send({
      status: "Error",
      error: error,
      message: error.message
    });
  }
};

module.exports = levantamientosController;
