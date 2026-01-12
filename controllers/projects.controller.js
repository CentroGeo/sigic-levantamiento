const { databasePool } = require("../postgres.db");
const wellknown = require("wellknown");

//import { stringify } from "wellknown/wellknown.js";
const fs = require("fs");
const path = require("path");

const exif = require("exiftool");
const appRoot = require("app-root-path");
const im = require("imagemagick");

const projectsController = {};

/*********** Sección API de Proyectos *****************/

/**
 * @function projectsPublic
 * @description Get all public projects
 * @param {*} req Request object
 * @param {*} res Response object
 * @returns {Promise<void>}
 */
projectsController.publicProjects = async (req, res) => {
  try {
    const page = parseInt(req.query.page, 12) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;

    const query = `
      SELECT l.*,
        l.region as ruta,
        CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder,
        l.es_institucion,
        count(l2.id) as num_aportaciones
      FROM public.proyectos as l
      LEFT JOIN public.levantamientos l2 on l2.id_proyecto = l.id
      WHERE l.es_privada = false
      GROUP BY l.id
      ORDER BY l.id DESC
      LIMIT  $1
      OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM public.proyectos
      WHERE es_privada = false
    `;

    const [{ rows: proyectos }, { rows: countRows }] = await Promise.all([
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
      proyectos: proyectos
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}


/**
 * @function projectsUser
 * @description Get all projects of a user
 * @param {*} req Request object
 * @param {*} res Response object
 * @returns {Promise<void>}
 */
projectsController.ownprojects = async (req, res) => {
  try {
    const userEmail = req.body.email;

    if (!userEmail) {
      return res.status(400).send({ message: "Correo electr&oacute;nico faltante" });
    }

    const page = parseInt(req.body.page, 12) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;

    const query = `
      SELECT l.*,
            l.region AS ruta,
            CONCAT('apidev/', REPLACE(l.imagen,'./','')) AS path_media_folder,
            l.es_institucion,
            count(l2.id) as num_aportaciones
      FROM public.proyectos AS l
      LEFT JOIN public.levantamientos l2 on l2.id_proyecto = l.id
      WHERE 
        l.id_propietario = '${userEmail}'
      GROUP BY l.id
      ORDER BY l.id DESC
      LIMIT  $1
      OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM public.proyectos AS l
      WHERE l.id_propietario = '${userEmail}'
    `;

    const [{ rows: proyectos }, { rows: countRows }] = await Promise.all([
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
      proyectos: proyectos
    });
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}

/**
 * @description Get all shared projects of a user
 * @param {*} req Request object
 * @param {*} res Response object
 * @returns {Promise<void>}
 */
projectsController.sharedProjects = async (req, res) => {
  try {
    const userEmail = req.body.email;

    if (!userEmail) {
      return res.status(400).send({ message: "Correo electr&oacute;nico faltante" });
    }

    const page = parseInt(req.body.page, 12) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;

    const query = `
      SELECT l.*,
            l.region AS ruta,
            pu.rol as rol,
            CONCAT('apidev/', REPLACE(l.imagen,'./','')) AS path_media_folder,
            l.es_institucion,
            count(l2.id) as num_aportaciones
      FROM public.proyectos AS l
      INNER JOIN proyectos_usuarios pu ON l.id = pu.proyecto_id
      LEFT JOIN public.levantamientos l2 on l2.id_proyecto = l.id
      WHERE 
        pu.correo = '${userEmail}'
        AND pu.rol IN ('administrar', 'revisar', 'aporta', 'ver')
      GROUP BY l.id, pu.rol
      ORDER BY l.id DESC
      LIMIT  $1
      OFFSET $2
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM public.proyectos AS l
      INNER JOIN proyectos_usuarios pu ON l.id = pu.proyecto_id
      WHERE 
        pu.correo = '${userEmail}'
        AND pu.rol IN ('administrar', 'revisar', 'aporta', 'ver')
    `;

    const [{ rows: proyectos }, { rows: countRows }] = await Promise.all([
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
      proyectos: proyectos
    });
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}


/**
 * 
 * @param {*} req 
 * @param {*} res 
 * @returns 
 */
projectsController.getRegisterProject = async (req, res) => {
  try {
    const userEmail = req.body.email;
    const id = req.params.id;
    
    const query = `
      SELECT l.*,
        l.region as ruta,
        CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder,
        l.es_institucion
      FROM public.proyectos as l
      WHERE l.id_propietario = '${userEmail}' and l.id=${id}
      ORDER BY l.id DESC
    `;

    const { rows } = await databasePool.query({ text: query});
    
    return res.status(200).send({
      proyectos: rows
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}


/**
 * Crea un nuevo proyecto y lo guarda en la base de datos.
 * 
 * @param {object} req - La petici&oacute;n HTTP que contiene la informaci&oacute;n del proyecto.
 * @param {object} res - La respuesta HTTP que se enviar&aacute;.
 * 
 * @returns {object} Un objeto con la informaci&oacute;n del proyecto guardado.
 */
projectsController.createProject = async (req, res) => {
  
  if (!req.body.nombre)
    return res.status(400).send({ message: "Falta el nombre del proyecto" });

  const url_first_image = req.file ? req.file.path : null;
  let esInstitucion = req.body.esInstitucion == "1" ? true : false;
  
  try {
    const fields = {
      nombre: req.body.nombre,
      descripcion: req.body.categoria,
      institucion: req.body.institucion,
      imagen: url_first_image,
      activo: false,
      id_propietario: req.body.id_propietario,
      fecha_creacion: new Date(),
      ficha_proyecto: req.body.ficha_proyecto,
      status: "SIN EVALUAR",
      lider: req.body.lider,
      objetivo: req.body.objetivo,
      especificaciones_multimedia: req.body.instrucciones,
      producto: req.body.producto,
      es_institucion: esInstitucion,
      es_privada: req.body.isPrivate !== undefined ? !!req.body.isPrivate : undefined,
    };

    const filteredEntries = Object.entries(fields)
      .filter(([_, value]) => value !== null && value !== undefined);

    // Columnas
    const columns = filteredEntries.map(([key]) => key);

    // placeholders $1, $2, ...
    const placeholders = filteredEntries.map((_, i) => `$${i + 1}`);

    // Valores
    const values = filteredEntries.map(([_, value]) => value);

    const query = `
      INSERT INTO public.proyectos (
        ${columns.join(', ')}
      )
      VALUES (
        ${placeholders.join(', ')}
      )
      RETURNING *
    `;

    const { rows } = await databasePool.query({
      text: query,
      values,
    });

    return res.status(200).send({
      status: "Proyecto guardado",
      proyecto: rows[0]
    });
  } catch (error) {
    console.log(error);
    return res.status(400).send({ message: error.message });
  }
};

projectsController.updateProject = async (req, res) => {
  console.log("update project");
  if (!req.body.nombre)
    return res.status(400).send({ message: "Falta el nombre del proyecto" });

  let esInstitucion = req.body.esInstitucion == "1" ? true : false;

  try {
    const fields = {
      nombre: req.body.nombre,
      descripcion: req.body.categoria, // cambiar descripcion por categoria
      institucion: req.body.institucion,
      ficha_proyecto: req.body.ficha_proyecto,
      lider: req.body.lider,
      objetivo: req.body.objetivo,
      especificaciones_multimedia: req.body.instrucciones, // instrucciones
      producto: req.body.producto,
      es_institucion: esInstitucion,
      es_privada: req.body.isPrivate !== undefined ? !!req.body.isPrivate : undefined,
    };
  
    const filteredEntries = Object.entries(fields)
      .filter(([_, value]) => value !== null && value !== undefined);
  
    if (filteredEntries.length === 0) {
      return res.status(400).json({
        message: 'No hay campos para actualizar',
      });
    }
  
    const setClause = filteredEntries
      .map(([key], index) => `${key}=$${index + 1}`)
      .join(', ');
  
    const values = filteredEntries.map(([_, value]) => value);
    values.push(req.params.id);
  
    const query = `
      UPDATE public.proyectos
      SET ${setClause}
      WHERE id=${values.length}
      RETURNING *
    `;
  
    const { rows } = await databasePool.query({
      text: query,
      values,
    });

    const url_first_image = req.file ? req.file.path : null;
    if (url_first_image) {
      if (rows[0].imagen) fs.unlinkSync(rows[0].imagen);

      await databasePool.query({
        text: `UPDATE public.proyectos
                    SET imagen = $1
        	        WHERE id = $2`,
        values: [url_first_image, req.params.id]
      });
    }

    return res.status(200).send({
      status: "Proyecto Actualizado",
      proyecto: rows[0]
    });
  } catch (error) {
    console.log("error al actualizar proyecto:", error);
    return res.status(400).send({ message: error.message });
  }
};


projectsController.deactivateProject = async (req, res) => {
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  if (!req.body.activo)
    return res
      .status(400)
      .send({ message: "Falta el status para activar o desactivar" });

  // id_desactivado_por: es el id de quien hizo el último cambio de estado (activado o desactivado) del proyecto
  // fecha_desactivacion: es la fecha del último cambio de estado (activado o desactivado) del proyecto

  try {
    await databasePool.query({
      text: `
        UPDATE public.proyectos
          SET 
            fecha_desactivacion=$1, 
            id_desactivado_por=$2, 
            activo=$3
        WHERE id=$4
      `,
      values: [
        new Date(), 
        req.body.user_id, 
        req.body.activo, 
        req.params.id
      ]
    });

    return res.status(200).send({
      status: "Proyecto actualizado"
    });
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
};



projectsController.sharedProjectsUserList = async (req, res) => {
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  const project = req.params.project;

  try {
    const { rows } = await databasePool.query({
      text: `
        SELECT *
        FROM public.proyectos_usuarios
        WHERE proyecto_id = $1
      `,
      values: [
        project
      ]
    });

    return res.status(200).send({
      usuarios: rows
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
};

projectsController.sharedProjectsUserAdd = async (req, res) => {
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  const project = req.params.project;

  try {
    const { rows } = await databasePool.query({
      text: `
        INSERT INTO 
        public.proyectos_usuarios (
          proyecto_id, 
          correo, 
          rol, 
          created_date,
          es_notificado
        ) VALUES (
          $1, 
          $2, 
          $3, 
          $4,
          $5
        )
      `,
      values: [
        project,
        req.body.email,
        req.body.rol,
        new Date(),
        true
      ]
    });

    return res.status(200).send({
      status: "Usuario guardado",
      usuarios: rows[0]
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
};


projectsController.sharedProjectsUserRemove = async (req, res) => {
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  const project = req.params.project;
  const id = req.params.user_id;

  try {
    await databasePool.query({
      text: `
        DELETE FROM public.proyectos_usuarios
        WHERE id = $1
      `,
      values: [
        id
      ]
    });

    return res.status(200).send({
      'status': 'Usuario eliminado'
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
};


projectsController.sharedProjectsUserUpdate = async (req, res) => {
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  const project = req.params.project;
  const id = req.params.user_id;

  try {
    await databasePool.query({
      text: `
        UPDATE public.proyectos_usuarios
        SET rol = $1
        WHERE id = $2
      `,
      values: [
        req.body.rol,
        id
      ]
    });

    return res.status(200).send({
      'status': 'Usuario actualizado'
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
};

projectsController.raisingProjectsUserList = async (req, res) => {
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electrónico faltante" });

  let query = `
		SELECT l.*, l.nombre as title, media_array as path_media_folder, u.email, i.nombre, i.apellido, uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador
		from levantamientos l 
		inner join users u on l.usuario_id = u.email
		inner join users_info i on u.id = i.user_id
    inner join proyectos p on l.id_proyecto = p.id
		LEFT join users uc on l.id_curador = uc.email
		LEFT join users_info ic on uc.id = ic.user_id
		where u.email = '${req.body.email}' and p.id = ${req.params.project}
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

module.exports = projectsController;
