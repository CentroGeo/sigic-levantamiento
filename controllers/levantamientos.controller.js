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

/* 	Petición POST a: http://localhost:8086/apidev/levantamientos/newLevantamiento    (con proxy)
          http://localhost:3006/levantamientos/newLevantamiento            (directo)

  crea un nuevo levantamiento

  recibe un json tipo:
  {
fecha: '2022-04-28',
estado: '',
municipio: '',
localidad: '',
    "id_cat_principal": 2,
    "id_cat_secundaria": 1,
    "id_usuario": "",  //uuid de usuario
    "titulo": "Nuevo levantamiento",
    "fecha_levantamiento": date,	//'28/4/2022 14:50:31'	
    "geometry": {} //json
    "fuente": "app"   //app o web
    "latitud": ""  //double
    "longitud": ""  //double,
    "id_proyecto": 1,
    respuestas: {
      objeto de respuestas
    },
    datos_usuario = {},
    ubicacion_sensible: false //true or false 	
  } */
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

levantamientosController.getRegister = async (req, res) => {
  try {
    const { rows } = await databasePool.query({
      text: `SELECT ficha_proyecto::json
				   FROM proyectos
				   WHERE id = $1 and ficha_proyecto is not null
					`,
      values: [req.body.id_project]
    });

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
      Object.entries(rows[0]["ficha_proyecto"]).forEach(([key, value]) => {
        respuestas.push(value);
      });
    } else {
    }

    return res.status(200).send({
      //answers: rows[0]["respuestas_ficha"]
      answers: respuestas,
      levantamientos: exist.rows[0].levantamientos
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

levantamientosController.list = async (req, res) => {
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electrónico faltante" });

  let query = `
		SELECT l.*, l.nombre as title, media_array as path_media_folder, u.email, i.nombre, i.apellido, uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador
		from levantamientos l 
		inner join users u on l.usuario_id = u.email
		inner join users_info i on u.id = i.user_id
		LEFT join users uc on l.id_curador = uc.email
		LEFT join users_info ic on uc.id = ic.user_id
		where u.email = '${req.body.email}'
	`;

  try {
    const { rows } = await databasePool.query({
      text: query
    });

    return res.status(200).send({
      total: rows.length,
      levantamientos: rows
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
			SELECT l.*, b.category as name_category 
      FROM public.levantamientos_mensajes as l
			LEFT join users u on l.usuario_id = u.email
			left join user_categories as b on b.id=u.category
			where levantamiento_id = ${req.body.id}
			order by fecha_hora asc
		`
    })
    .then(result => res.status(201).json(result.rows))
    .catch(error => res.status(400).send(error));
};


levantamientosController.chatReviewer = async (req, res) => {
  if (!req.body.report)
    return res.status(400).send({ message: "Reporte faltante" });
  if (!req.body.user_id)
    return res.status(400).send({ message: "ID faltante" });

  try {
    const insert_message = await databasePool.query({
      text: `
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

    const updateSql = {
      text: `
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
};


levantamientosController.chatCreator = async (req, res) => {
  if (!req.body.report)
    return res.status(400).send({ message: "Reporte faltante" });
  if (!req.body.user_id)
    return res.status(400).send({ message: "ID faltante" });

  try {
    const insert_message = await databasePool.query({
      text: `
				insert into 
          public.levantamientos_mensajes(
            levantamiento_id, 
            fecha_hora, 
            texto, 
            usuario_id
          )
				values($1, $2, $3, $4)
			`,
      values: [req.params.id, new Date(), req.body.report, req.body.user_id]
    });

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
};



module.exports = levantamientosController;
