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
const {
  generateContributionExport,
  normalizeContributionFormat
} = require("../services/contribution-exporter");

const levantamientosController = {};
const REVIEW_STATUSES = new Set(["NO REVISADO", "APROBADO", "RECHAZADO"]);
const REVIEW_PAGE_SIZE = 12;

/** Normaliza el correo utilizado en las validaciones de acceso a aportes. */
function normalizeEmail(value) {
  return String(value || "").trim();
}

/** Normaliza la paginación de los paneles administrativos de aportes. */
function normalizePage(value) {
  const page = Number.parseInt(value, 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/**
 * @swagger
 * /raising/{id}/export:
 *   get:
 *     tags: [Levantamientos]
 *     summary: Descarga un aporte en un formato geográfico
 *     description: Genera un ZIP con el archivo geográfico, el diccionario de datos y su carpeta multimedia.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del aporte.
 *       - in: query
 *         name: format
 *         required: true
 *         schema:
 *           type: string
 *           enum: [geojson, kml, shapefile]
 *         description: Formato geográfico solicitado.
 *       - in: query
 *         name: email
 *         required: true
 *         schema:
 *           type: string
 *           format: email
 *         description: Correo utilizado para validar el acceso al aporte.
 *     responses:
 *       200:
 *         description: Archivo ZIP generado correctamente.
 *         headers:
 *           Content-Disposition:
 *             schema:
 *               type: string
 *             description: Nombre sugerido para el archivo ZIP.
 *         content:
 *           application/zip:
 *             schema:
 *               type: string
 *               format: binary
 *       400:
 *         description: Parámetros incompletos o formato no soportado.
 *       404:
 *         description: Aporte inexistente o sin permiso de descarga.
 *       422:
 *         description: El aporte no contiene coordenadas válidas.
 *       500:
 *         description: No fue posible generar el archivo.
 */
levantamientosController.exportContribution = async (req, res) => {
  try {
    const contributionId = Number(req.params.id);
    const email = normalizeEmail(req.query.email);
    const format = normalizeContributionFormat(req.query.format);

    if (!Number.isInteger(contributionId) || contributionId <= 0)
      return res.status(400).send({ message: "ID de aporte inválido" });
    if (!email)
      return res.status(400).send({ message: "Correo electrónico faltante" });

    const { rows } = await databasePool.query({
      text: `
        SELECT l.*, p.nombre AS nombre_proyecto
        FROM public.levantamientos l
        INNER JOIN public.proyectos p ON p.id = l.id_proyecto
        WHERE l.id = $1
          AND (
            l.usuario_id = $2
            OR p.id_propietario = $2
            OR EXISTS (
              SELECT 1
              FROM public.proyectos_usuarios pu
              WHERE pu.proyecto_id = l.id_proyecto
                AND pu.correo = $2
                AND pu.rol IN ('administrar', 'revisar')
            )
          )
        LIMIT 1
      `,
      values: [contributionId, email]
    });

    if (!rows.length)
      return res.status(404).send({ message: "Aporte no encontrado o sin permiso de descarga" });

    const exported = await generateContributionExport(
      rows[0],
      format,
      path.resolve(process.cwd(), "uploads")
    );
    res.set({
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
      "Content-Type": exported.contentType,
      "Content-Length": exported.data.length,
      "Content-Disposition": `attachment; filename="${exported.fileName}"`
    });
    return res.send(exported.data);
  } catch (error) {
    console.error("Error al exportar aporte:", error);
    return res.status(error.statusCode || 500).send({
      message: error.message || "No fue posible exportar el aporte"
    });
  }
};



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
  const array_multimedia = (req.files || []).map((file) => ({
    original_name: file.originalname,
    file_name: file.filename,
    mimetype: file.mimetype,
    path: file.path.replace(/\\/g, "/")
  }));
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
        JSON.stringify(array_multimedia),
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

levantamientosController.updateLevantamiento = async (req, res) => {
  try {
    if (!req.body.id_usuario) {
      return res.status(400).send({ message: "Correo electrónico faltante" });
    }

    const { rows: existentes } = await databasePool.query({
      text: `
        SELECT media_array
        FROM public.levantamientos
        WHERE id = $1 AND usuario_id = $2
      `,
      values: [req.params.id, req.body.id_usuario]
    });

    if (!existentes.length) {
      return res.status(404).send({ message: "Aporte no encontrado" });
    }

    const mediaExistente = Array.isArray(existentes[0].media_array)
      ? existentes[0].media_array
      : JSON.parse(existentes[0].media_array || "[]");
    const mediaNueva = (req.files || []).map((file) => ({
      original_name: file.originalname,
      file_name: file.filename,
      mimetype: file.mimetype,
      path: file.path.replace(/\\/g, "/")
    }));

    const { rows } = await databasePool.query({
      text: `
        UPDATE public.levantamientos
        SET nombre = $1,
            fecha_guardado = $2,
            latitud = $3,
            longitud = $4,
            geom = ST_SetSRID(ST_MakePoint($4, $3), 4326),
            id_proyecto = $5,
            respuestas_ficha = $6,
            tiene_ficha = $7,
            media_array = $8,
            ubicacion_sensible = $9,
            ocultar_ficha = $10,
            status = $11
        WHERE id = $12 AND usuario_id = $13
        RETURNING *
      `,
      values: [
        req.body.titulo,
        new Date(),
        req.body.latitud,
        req.body.longitud,
        req.body.id_proyecto,
        req.body.respuestas || null,
        Boolean(req.body.respuestas),
        JSON.stringify([...mediaExistente, ...mediaNueva]),
        req.body.ubicacion_sensible,
        req.body.ocultar_ficha,
        req.body.status,
        req.params.id,
        req.body.id_usuario
      ]
    });

    return res.status(200).send({
      status: "ok",
      message: "Aporte actualizado",
      levantamiento: rows[0]
    });
  } catch (error) {
    return res.status(400).send({
      status: "Error",
      message: error.message
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
 * Lista los aportes creados por un usuario.
 * @swagger
 * /raising/user/list:
 *   post:
 *     tags: [Levantamientos]
 *     summary: Lista los aportes de un usuario por estado
 *     description: Obtiene de forma paginada los aportes creados por un usuario que coinciden con el estado solicitado.
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         description: Número de página.
 *       - in: query
 *         name: limit
 *         required: false
 *         description: Número máximo de aportes por página.
 *       - in: body
 *         name: email
 *         required: true
 *         description: Correo electrónico del usuario.
 *       - in: body
 *         name: status
 *         required: true
 *         description: Estado de los aportes.
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
 *                       description: Número de página.
 *                     limit:
 *                       type: integer
 *                       description: Número máximo de aportes por página.
 *                     total:
 *                       type: integer
 *                       description: Total de aportes encontrados.
 *                     totalPages:
 *                       type: integer
 *                       description: Total de páginas.
 *                 levantamientos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: Identificador del aporte.
 *                       nombre:
 *                         type: string
 *                         description: Nombre del aporte.
 *                       path_media_folder:
 *                         type: string
 *                         description: Referencias a los archivos multimedia del aporte.
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

    const total = Number.parseInt(countRows[0].total, 10);
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
 * Consulta el historial de comunicación de un aporte.
 * @swagger
 * /raising/chat/list:
 *   post:
 *     tags: [Levantamientos]
 *     summary: Consulta el historial de comunicación de un aporte
 *     description: Devuelve, en orden cronológico, los mensajes intercambiados durante la revisión de un aporte.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [id]
 *             properties:
 *               id:
 *                 type: integer
 *                 minimum: 1
 *                 description: Identificador del aporte.
 *     responses:
 *       200:
 *         description: Historial obtenido correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   id:
 *                     type: integer
 *                     description: Identificador del mensaje.
 *                   texto:
 *                     type: string
 *                     description: Contenido del mensaje.
 *                   fecha_hora:
 *                     type: string
 *                     description: Fecha y hora de creación.
 *                   usuario_id:
 *                     type: string
 *                     description: Identificador de la persona que envió el mensaje.
 *       400:
 *         description: Identificador faltante o no válido.
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
 * Registra una observación del revisor.
 * @swagger
 * /raising/chat/reviewer/{id}:
 *   put:
 *     tags: [Levantamientos]
 *     summary: Registra una observación del revisor
 *     description: Añade un mensaje al historial del aporte y actualiza su seguimiento dentro del proceso de revisión.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del aporte.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [report, user_id]
 *             properties:
 *               report:
 *                 type: string
 *                 description: Contenido de la observación.
 *               user_id:
 *                 type: string
 *                 description: Identificador de la persona revisora.
 *     responses:
 *       200:
 *         description: Observación registrada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Resultado de la operación.
 *       400:
 *         description: Mensaje o identificador de revisor faltante.
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
 * Registra una respuesta del autor del aporte.
 * @swagger
 * /raising/chat/creator/{id}:
 *   put:
 *     tags: [Levantamientos]
 *     summary: Registra una respuesta del autor del aporte
 *     description: Añade una respuesta al historial del aporte y continúa su proceso de atención.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del aporte.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:  
 *           schema:
 *             type: object
 *             required: [report, user_id]
 *             properties:
 *               report:
 *                 type: string
 *                 description: Contenido de la respuesta.
 *               user_id:
 *                 type: string
 *                 description: Identificador del autor del aporte.
 *     responses:
 *       200:
 *         description: Respuesta registrada correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Resultado de la operación.
 *       400:
 *         description: Mensaje o identificador del autor faltante.
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
 * Lista los aportes que un usuario puede revisar.
 * @swagger
 * /raising/reviewer/list:
 *   post:
 *     tags: [Levantamientos]
 *     summary: Lista los aportes disponibles para revisión
 *     description: Obtiene los aportes de proyectos propios o con permisos de administración/revisión, excluyendo los aportes creados por el revisor.
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
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
 *                 description: Estado de los aportes que se desea consultar.
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
 *                       description: Número máximo de aportes por página.
 *                     total:
 *                       type: integer
 *                       description: Total de aportes encontrados.
 *                     totalPages:
 *                       type: integer
 *                       description: Total de páginas.
 *                 levantamientos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: Identificador del aporte.
 *                       title:
 *                         type: string
 *                         description: Título del aporte.
 *                       path_media_folder:
 *                         type: string
 *                         description: Referencias a los archivos multimedia del aporte.
 *       400:
 *         description: Correo faltante o estado no permitido.
 */
levantamientosController.listReviewer = async (req, res) => {
  try {
    const page = normalizePage(req.query.page);
    const limit = REVIEW_PAGE_SIZE;
    const offset = (page - 1) * limit;
    const email = normalizeEmail(req.body.email);
    const status = String(req.body.status || "").trim();

    if (!email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
    if (!REVIEW_STATUSES.has(status))
      return res.status(400).send({ message: "Estado de aporte inválido" });

    // La revisión se concede por proyecto; ser autor de un aporte no otorga permisos
    // administrativos y tampoco permite autoaprobarlo.
    const query = `
      SELECT 
        l.*, l.nombre as title, media_array as path_media_folder
      FROM levantamientos l
      INNER JOIN proyectos p ON p.id = l.id_proyecto
      WHERE l.status = $2
        AND l.usuario_id <> $1
        AND (
          p.id_propietario = $1
          OR EXISTS (
            SELECT 1
            FROM proyectos_usuarios pu
            WHERE pu.proyecto_id = l.id_proyecto
              AND pu.correo = $1
              AND pu.rol IN ('administrar', 'revisar')
          )
        )
      ORDER BY l.fecha_guardado DESC, l.id DESC
      LIMIT $3
      OFFSET $4
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM levantamientos l
      INNER JOIN proyectos p ON p.id = l.id_proyecto
      WHERE l.status = $2
        AND l.usuario_id <> $1
        AND (
          p.id_propietario = $1
          OR EXISTS (
            SELECT 1
            FROM proyectos_usuarios pu
            WHERE pu.proyecto_id = l.id_proyecto
              AND pu.correo = $1
              AND pu.rol IN ('administrar', 'revisar')
          )
        )
    `;

    const [{ rows: levantamientos }, { rows: countRows }] = await Promise.all([
      databasePool.query({ text: query, values: [email, status, limit, offset] }),
      databasePool.query({ text: countQuery, values: [email, status] })
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
 *     summary: Actualiza el resultado de la revisión de un aporte
 *     description: Permite al propietario, administrador o revisor autorizado aprobar, rechazar o devolver un aporte ajeno a revisión.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del aporte.
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
 *                 enum: [NO REVISADO, APROBADO, RECHAZADO]
 *                 description: Nuevo estado del aporte.
 *               es_notificado:
 *                 type: boolean
 *                 description: Indica si se realizó la notificación correspondiente.
 *               report:
 *                 type: string
 *                 description: Comentario o motivo asociado con la revisión.
 *               user_id:
 *                 type: string
 *                 format: email
 *                 description: Correo del propietario, administrador o revisor.
 *     responses:
 *       200:
 *         description: Estado del aporte actualizado correctamente.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: ok
 *                 message:
 *                   type: string
 *                   example: proyecto actualizado
 *       400:
 *         description: Identificador, estado o correo del revisor inválido.
 *       403:
 *         description: El usuario no tiene permisos o intenta revisar su propio aporte.
 *       404:
 *         description: Aporte no encontrado.
*/
levantamientosController.reviewerLevantamientosStatus = async (req, res) => {
  try {
    if (!req.body.status)
      return res.status(400).send({ message: "Estado faltante" });
    const reviewerEmail = normalizeEmail(req.body.user_id || req.body.curador_id);
    const contributionId = Number(req.params.id);

    if (!reviewerEmail)
      return res.status(400).send({ message: "Correo electrónico del revisor faltante" });
    if (!Number.isInteger(contributionId) || contributionId <= 0)
      return res.status(400).send({ message: "ID de aporte inválido" });
    if (!REVIEW_STATUSES.has(req.body.status))
      return res.status(400).send({ message: "Estado de aporte inválido" });

    // Repite la autorización en escritura; el filtro del listado no es una barrera de seguridad.
    const { rows: authorizedRows } = await databasePool.query({
      text: `
        SELECT l.id
        FROM public.levantamientos l
        INNER JOIN public.proyectos p ON p.id = l.id_proyecto
        WHERE l.id = $1
          AND l.usuario_id <> $2
          AND (
            p.id_propietario = $2
            OR EXISTS (
              SELECT 1
              FROM public.proyectos_usuarios pu
              WHERE pu.proyecto_id = l.id_proyecto
                AND pu.correo = $2
                AND pu.rol IN ('administrar', 'revisar')
            )
          )
        LIMIT 1
      `,
      values: [contributionId, reviewerEmail]
    });

    if (!authorizedRows.length)
      return res.status(403).send({
        message: "No tienes permiso para revisar este aporte o es un aporte propio"
      });

    const values = [];
    const fields = [];
    let index = 1;

    values.push(req.body.status)
    fields.push(`status = $${index++}`)

    if (req.body.status === "APROBADO" || req.body.status === "RECHAZADO") {
      values.push(reviewerEmail)
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
    values.push(contributionId);

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
      RETURNING id
    `;

    const updateSql = {
      text: query,
      values: values
    };

    // Ejecuta la consulta de actualizaci n
    const { rows } = await databasePool.query(updateSql);

    if (!rows.length)
      return res.status(404).send({ message: "Aporte no encontrado" });

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
