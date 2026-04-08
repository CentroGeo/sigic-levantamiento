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

/**
 * @swagger
 * /raising/save:
 *   post:
 *     tags: [Levantamientos]
 *     summary: Crear un nuevo levantamiento
 *     description: Guarda la informaci&oacute;n de un levantamiento, incluyendo respuestas a cuestionarios y ubicaci&oacute;n.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_usuario:
 *                 type: string
 *                 description: ID (email) del usuario
 *               titulo:
 *                 type: string
 *                 description: T&iacute;tulo o nombre del levantamiento
 *               fecha_levantamiento:
 *                 type: string
 *                 description: Fecha y hora del levantamiento (soporta formato 12/24h)
 *               fuente:
 *                 type: string
 *                 enum: ["web", "app"]
 *                 description: Origen del levantamiento
 *               latitud:
 *                 type: number
 *                 description: Coordenada de latitud
 *               longitud:
 *                 type: number
 *                 description: Coordenada de longitud
 *               id_proyecto:
 *                 type: integer
 *                 description: ID del proyecto al que pertenece
 *               respuestas:
 *                 type: object
 *                 description: Objeto con las respuestas del cuestionario (clave-valor din&aacute;mico)
 *               datos_usuario:
 *                 type: string
 *                 description: Datos adicionales del usuario en formato texto/JSON
 *               ubicacion_sensible:
 *                 type: boolean
 *                 description: Indica si la ubicaci&oacute;n es sensible
 *               estado:
 *                 type: string
 *                 description: Estado geogr&aacute;fico (calculado autom&aacute;ticamente si no se env&iacute;a, pero puede forzarse)
 *               municipio:
 *                 type: string
 *                 description: Municipio (calculado autom&aacute;ticamente)
 *               localidad:
 *                 type: string
 *                 description: Localidad (calculada autom&aacute;ticamente)
 *               isFromGallery:
 *                 type: boolean
 *                 description: Indica si se cre&oacute; desde galer&iacute;a
 *               in_situ:
 *                 type: boolean
 *                 description: Indica si se tom&oacute; en el sitio
 *               ocultar_ficha:
 *                 type: boolean
 *                 description: Bandera para ocultar la ficha
 *               datos_institucion:
 *                 type: object
 *                 properties:
 *                   entidad_cvegeo:
 *                      type: string
 *                   entidad_nombre:
 *                      type: string
 *                   institucion_nombre:
 *                      type: string
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 levantamiento_id:
 *                   type: integer
 */
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
 * /raising/user/create:
 *   post:
 *     tags: [Levantamientos]
 *     summary: Crear un nuevo levantamiento
 *     description: Guarda la informaci&oacute;n de un levantamiento, incluyendo respuestas a cuestionarios y ubicaci&oacute;n.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_usuario:
 *                 type: string
 *                 description: ID (email) del usuario
 *               titulo:
 *                 type: string
 *                 description: T&iacute;tulo o nombre del levantamiento
 *               fecha_levantamiento:
 *                 type: string
 *                 description: Fecha y hora del levantamiento (soporta formato 12/24h)
 *               fuente:
 *                 type: string
 *                 enum: ["web", "app"]
 *                 description: Origen del levantamiento
 *               latitud:
 *                 type: number
 *                 description: Coordenada de latitud
 *               longitud:
 *                 type: number
 *                 description: Coordenada de longitud
 *               id_proyecto:
 *                 type: integer
 *                 description: ID del proyecto al que pertenece
 *               respuestas:
 *                 type: object
 *                 description: Objeto con las respuestas del cuestionario (clave-valor din&aacute;mico)
 *               datos_usuario:
 *                 type: string
 *                 description: Datos adicionales del usuario en formato texto/JSON
 *               ubicacion_sensible:
 *                 type: boolean
 *                 description: Indica si la ubicaci&oacute;n es sensible
 *               estado:
 *                 type: string
 *                 description: Estado geogr&aacute;fico (calculado autom&aacute;ticamente si no se env&iacute;a, pero puede forzarse)
 *               municipio:
 *                 type: string
 *                 description: Municipio (calculado autom&aacute;ticamente)
 *               localidad:
 *                 type: string
 *                 description: Localidad (calculada autom&aacute;ticamente)
 *               isFromGallery:
 *                 type: boolean
 *                 description: Indica si se cre&oacute; desde galer&iacute;a
 *               in_situ:
 *                 type: boolean
 *                 description: Indica si se tom&oacute; en el sitio
 *               ocultar_ficha:
 *                 type: boolean
 *                 description: Bandera para ocultar la ficha
 *               datos_institucion:
 *                 type: object
 *                 properties:
 *                   entidad_cvegeo:
 *                      type: string
 *                   entidad_nombre:
 *                      type: string
 *                   institucion_nombre:
 *                      type: string
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                 message:
 *                   type: string
 *                 levantamiento_id:
 *                   type: integer
 */
levantamientosController.createLevantamiento = async (req, res) => {

  console.log("***********************");
  console.log("crear levantamiento");
  console.log(req.body);
  let sql_insert = "";
  let json_respuestas = null;
  let array_multimedia = [];
  let isFromGallery = false; //por default
  let in_situ = true; //por default

  try {
    isFromGallery = true;
    in_situ = false;
    // if (req.body.fuente == "web") {
    //   //si se mandó el id de proyecto (es opcional)
    //   in_situ = false;
    // } else {
    //   //viene de app
    //   console.log("viene de app");
    //   if (req.body.isFromGallery != null) {
    //     //si se mandó el id de proyecto (es opcional)
    //     isFromGallery = req.body.isFromGallery;
    //   }

    //   if (req.body.in_situ != null) {
    //     //si se mandó el id de proyecto (es opcional)
    //     in_situ = req.body.in_situ;
    //   }
    // }

    let tiene_ficha = req.body.respuestas ? true : false;
    json_respuestas = req.body.respuestas;

    let estado = "";
    let municipio = "";
    let localidad = "";
    let fecha_levantamiento = new Date();
    let default_status = req.body.status || "NO REVISADO";

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
        req.body.datos_institucion?.entidad_cvegeo,
        req.body.datos_institucion?.entidad_nombre,
        req.body.datos_institucion?.institucion_nombre
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
 * /raising/register:
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

/**
 * @swagger
 * /raising/getRegisterV2:
 *   post:
 *     tags: [Levantamientos]
 *     summary: Obtener detalle de levantamiento (V2)
 *     description: Recupera las respuestas y metadatos de un levantamiento espec&iacute;fico.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id_levantamiento:
 *                 type: integer
 *                 description: ID del levantamiento a consultar
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
 *                   description: Lista de respuestas del levantamiento
 *                   items:
 *                      type: object
 *                 path_media_folder:
 *                   type: string
 *                   description: Ruta de la carpeta de medios
 *                 title:
 *                   type: string
 *                   description: Nombre del levantamiento
 */
levantamientosController.getRegisterV2 = async (req, res) => {
  try {
    const { rows } = await databasePool.query({
      text: `SELECT respuestas_ficha::json, l.media_array as path_media_folder, l.nombre,
            l.fecha_levantamiento, 
            l.fecha_guardado,
            l.fuente, 
            l.latitud, 
            l.longitud, 
            l.status, 
            l.tiene_ficha, 
            l.id_proyecto, 
            l.datos_usuario, 
            l.ubicacion_sensible, 
            l.estado, 
            l.municipio, 
            l.localidad, 
            l.isfromgallery, 
            l.insitu, 
            l.ocultar_ficha
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
      title: rows.length > 0 ? rows[0].nombre : null,
      fecha_levantamiento: rows.length > 0 ? rows[0].fecha_levantamiento : null,
      fecha_guardado: rows.length > 0 ? rows[0].fecha_guardado : null,
      fuente: rows.length > 0 ? rows[0].fuente : null,
      latitud: rows.length > 0 ? rows[0].latitud : null,
      longitud: rows.length > 0 ? rows[0].longitud : null,
      status: rows.length > 0 ? rows[0].status : null,
      tiene_ficha: rows.length > 0 ? rows[0].tiene_ficha : null,
      id_proyecto: rows.length > 0 ? rows[0].id_proyecto : null,
      datos_usuario: rows.length > 0 ? rows[0].datos_usuario : null,
      ubicacion_sensible: rows.length > 0 ? rows[0].ubicacion_sensible : null,
      estado: rows.length > 0 ? rows[0].estado : null,
      municipio: rows.length > 0 ? rows[0].municipio : null,
      localidad: rows.length > 0 ? rows[0].localidad : null,
      isfromgallery: rows.length > 0 ? rows[0].isfromgallery : null,
      insitu: rows.length > 0 ? rows[0].insitu : null
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send({ message: error.message });
  }
};

/**
 * List the projects of a user
 * @swagger
 * /raising/user/list:
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

/**
 * List the chat of a levantamiento
 * @swagger
 * /raising/chat/list:
 *   get:
 *     tags: [Levantamientos]
 *     summary: List the chat of a levantamiento
 *     description: List the chat of a levantamiento
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del levantamiento
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     description: ID of the message
 *                   texto:
 *                     type: string
 *                     description: Text of the message
 *                   fecha_hora:
 *                     type: string
 *                     description: Date and time of the message
 *                   usuario_id:
 *                     type: integer
 *                     description: ID of the user who sent the message
 */
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
 * /raising/chat/reviewer/{id}:
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
 * /raising/chat/creator/{id}:
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
 * /raising/reviewer/list:
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
      inner join proyectos p on p.id = l.id_proyecto
      INNER join proyectos_usuarios pu on pu.proyecto_id = l.id_proyecto
      WHERE ((pu.correo='${req.body.email}' and pu.rol IN ('administrar', 'revisar')) and l.status = '${req.body.status}' and ${req.body.status == 'SIN EVALUAR' ? `(l.id_curador = '${req.body.email}' OR l.id_curador is null)` : `l.id_curador = '${req.body.email}'`})
            or p.id_propietario = '${req.body.email}'
      LIMIT  $1
      OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM levantamientos l
      inner join proyectos p on p.id = l.id_proyecto
      inner join proyectos_usuarios pu on pu.proyecto_id = l.id_proyecto
      WHERE ((pu.correo='${req.body.email}' and pu.rol IN ('administrar', 'revisar')) and l.status = '${req.body.status}' and ${req.body.status == 'SIN EVALUAR' ? `(l.id_curador = '${req.body.email}' OR l.id_curador is null)` : `l.id_curador = '${req.body.email}'`})
            or p.id_propietario = '${req.body.email}'
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

/** 
 * @swagger
 * /raising/reviewer/status/{id}:
 *   post:
 *     tags: [Levantamientos]
 *     summary: "Actualizar el estado de un levantamiento"
 *     description: "Actualizar el estado de un levantamiento"
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del levantamiento a actualizar    
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string 
 *                 description: Estado del levantamiento
 *               notificado:
 *                 type: boolean
 *                 description: Indica si se ha notificado al curador
 *               report:
 *                 type: string 
 *               user_id:
 *                 type: string 
 *                 description: ID del curador
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
*/
levantamientosController.reviewerLevantamientosStatus = async (req, res) => {
  try {
    // Actualiza el estado de notificado de un levantamiento
    if (!req.body.status)
      return res.status(400).send({ message: "Estado faltante" });
    // if (!req.body.report)
    //   return res.status(400).send({ message: "Reporte faltante" });
    // if (!req.body.user_id)
    //   return res.status(400).send({ message: "ID faltante" });

    values = [];
    fields = [];
    let index = 1;

    values.push(req.body.status)
    fields.push(`status = $${index++}`)

    if(req.body.curador_id){
      values.push(req.body.curador_id)
      fields.push(`id_curador = $${index++}`)

      values.push(new Date())
      fields.push(`fecha_aceptacion = $${index++}`)
    }

    if(req.body.report){
      values.push(req.body.report)
      fields.push(`comentario_curador = $${index++}`)
    }

    if(req.body.respuestas){
      values.push(req.body.respuestas)
      fields.push(`respuestas_ficha = $${index++}`)
    }

    if(req.body.es_notificado){
      values.push(req.body.es_notificado)
      fields.push(`es_notificado = $${index++}`)
    }

    // Eliminar imágenes seleccionadas (images_delete)
    if (req.body.images_delete && Array.isArray(req.body.images_delete)) {
      const projectId = req.body.id_proyecto;
      const subfolder = projectId ? projectId : "images";
      const basePath = `./uploads/levantamientos/${subfolder}/`;

      req.body.images_delete.forEach(imageName => {
        const imagePath = path.join(basePath, imageName);
        try {
          if (fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
            console.log(`Archivo eliminado: ${imagePath}`);
          }
        } catch (err) {
          console.error(`Error al eliminar imagen ${imagePath}:`, err);
        }
      });
    }

    let whereClause = `WHERE id = $${index++}`;
    values.push(req.params.id);

    // Si hay respuestas, forzar validación por usuario_id
    if (req.body.respuestas) {
      if (!req.body.user_id) {
        return res.status(400).send({ message: "ID de usuario faltante para actualizar respuestas" });
      }
      whereClause += ` AND usuario_id = $${index++}`;
      values.push(req.body.user_id);
    }

    const query = `
      UPDATE public.levantamientos
      SET ${fields.join(", ")}
      ${whereClause}
    `;

    const updateSql = {
      text: query,
      values: values
    };

    // Ejecuta la consulta de actualizaci n
    const { rows } = await databasePool.query(updateSql);

    // Devuelve una respuesta con el estado de la operaci n
    return res.status(200).send({
      status: "ok",
      message: "proyecto actualizado"
    });
  } catch (error) {
    // Devuelve una respuesta con el mensaje de error
    return res.status(400).send({ message: error.message });
  }
};

/**
 * @swagger
 * /raising/{id}:
 *   delete:
 *     tags: [Levantamientos]
 *     summary: Elimina un levantamiento
 *     description: Elimina un levantamiento
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del levantamiento
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 */
levantamientosController.deleteLevantamiento = async (req, res) => {
  try {
    const deleteSql = {
      text: "DELETE FROM public.levantamientos WHERE id = $1",
      values: [req.params.id]
    };
    const { rows } = await databasePool.query(deleteSql);
    return res.status(200).send({
      status: "ok",
      message: "levantamiento eliminado"
    });
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}
module.exports = levantamientosController;
