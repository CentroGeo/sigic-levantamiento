const { databasePool } = require("../postgres.db");
const wellknown = require("wellknown");

//import { stringify } from "wellknown/wellknown.js";
const fs = require("fs");
const path = require("path");

const exif = require("exiftool");
const appRoot = require("app-root-path");
const im = require("imagemagick");
const Mailer = require("../helpers/Mailer");

const projectsController = {};

const PROJECT_ROLES = new Set(['administrar', 'revisar', 'aporta', 'ver']);
const PROJECT_STATUSES = new Set(['SIN EVALUAR', 'EN REVISION', 'APROBADO', 'RECHAZADO']);

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/*********** Sección API de Proyectos *****************/

/**
 * @swagger
 * /projects/public:
 *   get:
 *     tags: [Proyectos]
 *     summary: "Obtener proyectos p&uacute;blicos"
 *     description: "Obtener la lista de proyectos p&uacute;blicos"
 *     parameters:
 *       - in: query
 *         name: page
 *         required: false
 *         description: "P&aacute;gina"
 *       - in: query
 *         name: limit
 *         required: false
 *         description: "N&uacute;mero de proyectos por p&aacute;gina"
 *     responses:
 *       200:
 *         description: "Lista de proyectos p&uacute;blicos"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     page:
 *                       type: number
 *                     limit:
 *                       type: number
 *                     total:
 *                       type: number
 *                     totalPages:
 *                       type: number
 *                 proyectos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: number
 *                       titulo:
 *                         type: string
 *                       descripcion:
 *                         type: string
 *                       imagen:
 *                         type: string
 *                       ruta:
 *                         type: string
 *                       num_aportaciones:
 *                         type: number
 *                       es_institucion:
 *                         type: boolean
 *                       es_privada:
 *                         type: boolean
 *                       fecha_creacion:
 *                         type: string
 *                       fecha_actualizacion:
 *                         type: string
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
      WHERE l.es_privada = false and l.activo=true
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

};

/**
 * @swagger
 * /projects/own:
 *   post:
 *     tags: [Proyectos]
 *     summary: "Obtener proyectos propios de un usuario"
 *     description: "Obtener la lista de proyectos propios de un usuario"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: "Correo electr&oacute;nico del usuario"
 *                 example: "usuario@example.com"
 * 
 *     responses:
 *       "200":
 *         description: "OK"
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
 *                       description: "P&aacute actual"
 *                     limit:
 *                       type: integer
 *                       description: "L&iacute m&aacute de proyectos por p&aacute"
 *                     total:
 *                       type: integer
 *                       description: "Total de proyectos"
 *                     totalPages:
 *                       type: integer
 *                       description: "Total de p&aacuteinas"
 *                 proyectos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: "ID del proyecto"
 *                       nombre:
 *                         type: string
 *                         description: "Nombre del proyecto"
 *                       region:
 *                         type: string
 *                         description: "Ruta del proyecto"
 *                       path_media_folder:
 *                         type: string
 *                         description: "Ruta de la carpeta de medios del proyecto"
 *                       es_institucion:
 *                         type: boolean
 *                         description: "Indica si el proyecto es de una instituci&oacute;n"
 *                       num_aportaciones:
 *                         type: integer
 *                         description: "Total de aportaciones del proyecto"
 *       "400":
 *         description: "Bad Request"
 *       "500":
 *         description: "Internal Server Error"
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
        l.id_propietario = '${userEmail}' and l.activo=true
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
 * @swagger
 * /projects/shared:
 *   post:
 *     tags: [Proyectos]
 *     summary: "Obtener proyectos compartidos con un usuario"
 *     description: "Obtener la lista de proyectos compartidos con un usuario"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 description: "Correo electr&oacute;nico del usuario"
 *                 example: "usuario@example.com"
 *               page:
 *                 type: integer
 *                 description: "P&aacute actual" 
 *                 example: 1
 *                 required: false
 *     responses:
 *       "200":
 *         description: "OK"
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
 *                       description: "P&aacute actual"
 *                     limit:
 *                       type: integer
 *                       description: "L&iacute m&aacute de proyectos por p&aacute"
 *                     total:
 *                       type: integer
 *                       description: "Total de proyectos"
 *                     totalPages:
 *                       type: integer
 *                       description: "Total de p&aacuteinas"
 *                 proyectos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: "ID del proyecto"
 *                       nombre:
 *                         type: string
 *                         description: "Nombre del proyecto"
 *                       region:
 *                         type: string
 *                         description: "Ruta del proyecto"
 *                       path_media_folder:
 *                         type: string
 *                         description: "Ruta de la carpeta de medios del proyecto"
 *                       es_institucion:
 *                         type: boolean
 *                         description: "Indica si el proyecto es de una instituci&oacute;n"
 *                       num_aportaciones:
 *                         type: integer
 *                         description: "Total de aportaciones del proyecto"
 *       "400":
 *         description: "Bad Request"
 *       "500":
 *         description: "Internal Server Error"
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
        AND l.activo=true
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
 * @swagger
 * /projects/register/:id:
 *   post:
 *     tags: [Proyectos]
 *     summary: Obtiene un proyecto por su id y usuario
 *     description: Obtiene un proyecto por su id y usuario
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID del proyecto
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
 *               id:
 *                 type: integer
 *                 description: ID del proyecto
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 proyectos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID del proyecto
 *                       nombre:
 *                         type: string
 *                         description: Nombre del proyecto
 *                       region:
 *                         type: string
 *                         description: Ruta del proyecto
 *                       path_media_folder:
 *                         type: string
 *                         description: Ruta de la carpeta de medios del proyecto
 *                       es_institucion:
 *                         type: boolean
 *                         description: Indica si el proyecto es de una instituci&oacute;n
 *       400:
 *         description: Bad Request
 */
projectsController.getRegisterProject = async (req, res) => {
  try {
    const userEmail = req.body.email;
    const id = req.params.id;

    if (!userEmail) {
      return res.status(400).send({ message: "Correo electr&oacute;nico faltante" });
    }

    // Permite cargar la configuración al propietario o a un participante con rol administrar.
    const query = `
      SELECT l.*,
        l.region as ruta,
        CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder,
        l.es_institucion,
        count(l2.id) as num_aportaciones
      FROM public.proyectos as l
      LEFT JOIN public.levantamientos l2 on l2.id_proyecto = l.id
      WHERE l.id = $1
        AND (
          l.id_propietario = $2
          OR EXISTS (
            SELECT 1
            FROM public.proyectos_usuarios pu
            WHERE pu.proyecto_id = l.id
              AND pu.correo = $2
              AND pu.rol = 'administrar'
          )
        )
      GROUP BY l.id
      ORDER BY l.id DESC
    `;

    const { rows } = await databasePool.query({
      text: query,
      values: [id, userEmail],
    });

    return res.status(200).send({
      proyectos: rows
    });

  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}

/**
 * Crea un nuevo proyecto
 * @swagger
 * /projects/create:
 *   post:
 *     tags: [Proyectos]
 *     summary: Crear un nuevo proyecto
 *     description: Crear un nuevo proyecto con soporte para subida de imagen
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *                 description: Nombre del proyecto
 *               categoria:
 *                 type: string
 *                 description: Categor&iacute;a del proyecto
 *               institucion:
 *                 type: string
 *                 description: Instituci&oacute;n del proyecto
 *               file:
 *                 type: string
 *                 format: binary
 *                 description: Imagen principal del proyecto
 *               id_propietario:
 *                 type: string
 *                 description: ID (email) del propietario del proyecto
 *               ficha_proyecto:
 *                 type: string
 *                 description: JSON string con la estructura de la ficha/cuestionario
 *               lider:
 *                 type: string
 *                 description: Lider del proyecto
 *               objetivo:
 *                 type: string
 *                 description: Objetivo del proyecto
 *               instrucciones:
 *                 type: string
 *                 description: Instrucciones del proyecto
 *               producto:
 *                 type: string
 *                 description: Producto esperado del proyecto
 *               esInstitucion:
 *                 type: string
 *                 enum: ["0", "1"]
 *                 description: Indica si el proyecto es de una instituci&oacute;n
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
 *                   description: Estado de la operaci&oacute;n
 *                 proyecto:
 *                   type: object
 *                   description: Proyecto creado
 */
projectsController.createProject = async (req, res) => {

  if (!req.body.nombre)
    return res.status(400).send({ message: "Falta el nombre del proyecto" });

  const url_first_image = req.file ? req.file.path : null;
  let esInstitucion = req.body.esInstitucion == "1" ? true : false;

  try {
    const fields = {
      nombre: req.body.nombre,
      categoria: req.body.categoria,
      institucion: req.body.institucion,
      imagen: url_first_image,
      activo: true,
      id_propietario: req.body.id_propietario,
      fecha_creacion: new Date(),
      ficha_proyecto: req.body.ficha_proyecto,
      status: "SIN EVALUAR",
      lider: req.body.lider,
      objetivo: req.body.objetivo,
      instrucciones: req.body.instrucciones,
      producto: req.body.producto,
      es_institucion: esInstitucion,
      es_privada: true,
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

/**
 * Actualizar un proyecto en la base de datos
 * @swagger
 * /projects/update/:id:
 *   put:
 *     tags: [Proyectos]
 *     summary: Actualizar un proyecto
 *     description: Actualizar un proyecto en la base de datos
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del proyecto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: ID del proyecto
 *               nombre:
 *                 type: string
 *                 description: Nombre del proyecto
 *               categoria:
 *                 type: string
 *                 description: Categor&iacute del proyecto
 *               institucion:
 *                 type: string
 *                 description: Instituci&oacute;n del proyecto
 *               imagen:
 *                 type: string (optional)
 *                 description: Imagen del proyecto
 *               activo:
 *                 type: boolean
 *                 description: Activo del proyecto
 *               id_propietario:
 *                 type: string
 *                 description: ID del propietario del proyecto
 *               ficha_proyecto:
 *                 type: string
 *                 description: Ficha del proyecto
 *               status:
 *                 type: string
 *                 description: Estado del proyecto
 *               lider:
 *                 type: string
 *                 description: L&iacuteder del proyecto
 *               objetivo:
 *                 type: string
 *                 description: Objetivo del proyecto
 *               instrucciones:
 *                 type: string
 *                 description: Instrucciones del proyecto
 *               producto:
 *                 type: string
 *                 description: Producto del proyecto
 *               esInstitucion: 
 *                 type: boolean
 *                 description: Indica si el proyecto es de una instituci&oacute;n
 *               isPrivate:
 *                 type: boolean  
 *                 description: Indica si el proyecto es privado
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
 *                   description: Estado de la operaci&oacute;n
 *                 proyecto:
 *                   type: object
 *                   description: Proyecto actualizado
 */
projectsController.updateProject = async (req, res) => {
  console.log("update project");
  let esInstitucion = req.body.esInstitucion == "1" ? true : false;

  try {
    const fields = {
      nombre: req.body.nombre,
      categoria: req.body.categoria, // cambiar descripcion por categoria
      institucion: req.body.institucion,
      ficha_proyecto: JSON.stringify(req.body.ficha_proyecto),
      lider: req.body.lider,
      objetivo: req.body.objetivo,
      instrucciones: req.body.instrucciones, // instrucciones
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
      .map(([key], index) => `${key === 'ficha_proyecto' ? `${key}=$${index + 1}::jsonb` : `${key}=$${index + 1}`}`)
      .join(', ');

    const values = filteredEntries.map(([_, value]) => value);
    values.push(req.params.id);


    const query = `
      UPDATE public.proyectos
      SET ${setClause}
      WHERE id=$${values.length}
      RETURNING *
    `;

    console.log(query, values)

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

/**
 * Desactiva un proyecto
 * @swagger
 * /projects/deactivate/{id}:
 *   put:
 *     tags: [Proyectos]
 *     summary: Desactiva un proyecto
 *     description: Desactiva un proyecto
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del proyecto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: integer
 *                 description: ID del proyecto
 *               activo:
 *                 type: boolean
 *                 description: Activo del proyecto
 *               id_desactivado_por:
 *                 type: integer
 *                 description: ID del usuario que desactiv&oacute; el proyecto
 *     responses:
 *       200:
 *         description: Proyecto actualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Estado de la operaci n
 *     400:
 *       description: Bad Request
 */
projectsController.deactivateProject = async (req, res) => {
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  // id_desactivado_por: es el id de quien hizo el  ltimo cambio de estado (activado o desactivado) del proyecto
  // fecha_desactivacion: es la fecha del  ltimo cambio de estado (activado o desactivado) del proyecto

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
        false,
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

/**
 * @swagger
 * /projects/shared/{project}/user/list:
 *   post:
 *     tags: [Proyectos]
 *     summary: "Obtener lista de usuarios que tienen acceso a un proyecto"
 *     description: "Obtener la lista de usuarios que tienen acceso a un proyecto"
 *     parameters:
 *       - in: path
 *         name: project
 *         required: true
 *         description: ID del proyecto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project:
 *                 type: integer
 *                 description: ID del proyecto
 *               user_id:
 *                 type: integer
 *                 description: ID del usuario
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 usuarios:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID del usuario
 *                       correo:
 *                         type: string
 *                         description: Correo electr&oacute;nico del usuario
 *                       rol:
 *                         type: string
 *                         description: Rol del usuario en el proyecto (administrar, revisar, aporta, ver)
 *  
 */
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
        order by id
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

/**
 * Agrega un usuario a un proyecto compartido
 * 
 * @swagger
 * /projects/shared/{project}/user/add:
 *   post:
 *     tags: [Proyectos]
 *     summary: Agrega un usuario a un proyecto compartido
 *     description: Agrega un usuario a un proyecto compartido
 *     parameters:
 *       - in: path
 *         name: project
 *         required: true
 *         description: ID del proyecto
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:   
 *           schema:
 *             type: object
 *             properties:
 *               project:
 *                 type: integer
 *                 description: ID del proyecto
 *               user_id:
 *                 type: integer
 *                 description: ID del usuario
 *               email:
 *                 type: string
 *                 description: Correo electr&oacute;nico del usuario
 *               rol:
 *                 type: string
 *                 description: Rol del usuario en el proyecto (administrar, revisar, aporta, ver)
 *               message:
 *                 type: string
 *                 maxLength: 500
 *                 description: Mensaje personalizado que acompa&ntilde;a la invitaci&oacute;n
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
 *                   description: Estado de la operaci n
 */
projectsController.sharedProjectsUserAdd = async (req, res) => {
  // Verifica si el usuario proporcion&oacute; el email del usuario
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  // Obtiene el id del proyecto
  const project = req.params.project;

  const email = String(req.body.email || '').trim().toLowerCase();
  const message = String(req.body.message || '').trim();
  const role = req.body.rol;

  // Valida los datos y evita participantes duplicados en el proyecto.
  if (!EMAIL_PATTERN.test(email))
    return res.status(400).send({ message: "Ingresa un correo electrónico válido" });
  if (!PROJECT_ROLES.has(role))
    return res.status(400).send({ message: "El permiso indicado no es válido" });
  if (!message)
    return res.status(400).send({ message: "El mensaje de invitación es obligatorio" });
  if (message.length > 500)
    return res.status(400).send({ message: "El mensaje de invitación no debe superar 500 caracteres" });

  try {
    const { rows: projects } = await databasePool.query({
      text: `SELECT id, id_propietario FROM public.proyectos WHERE id = $1 AND activo = true`,
      values: [project]
    });

    if (!projects.length)
      return res.status(404).send({ message: "El proyecto no existe" });
    if (String(projects[0].id_propietario).toLowerCase() === email)
      return res.status(400).send({ message: "La persona propietaria ya pertenece al proyecto" });

    const { rows: existingUsers } = await databasePool.query({
      text: `
        SELECT id FROM public.proyectos_usuarios
        WHERE proyecto_id = $1 AND LOWER(correo) = $2
      `,
      values: [project, email]
    });

    if (existingUsers.length)
      return res.status(409).send({ message: "La persona ya participa en este proyecto" });

    const { rows } = await databasePool.query({
      text: `
        INSERT INTO 
        public.proyectos_usuarios (
          proyecto_id, 
          correo, 
          rol, 
          created_date,
          es_notificado,
          texto
        ) VALUES (
          $1, 
          $2, 
          $3, 
          $4,
          $5,
          $6
        )
        RETURNING *
      `,
      values: [
        project,
        email,
        role,
        new Date(),
        true,
        message
      ]
    });

    try {
      const mailer = new Mailer();
  
      mailer.templateGuestUser();
      await mailer.send("Invitación a participar ", email);
    } catch (error) {
      console.log(error)
    }


    // Regresa el usuario insertado
    return res.status(200).send({
      status: "Usuario guardado",
      usuarios: rows[0]
    });

  } catch (error) {
    // Regresa un error en caso de que algo salga mal
    console.log(error)
    return res.status(400).send({ message: error.message });
  }
};


/**
 * Elimina un usuario de un proyecto
 * @swagger
 * /projects/shared/{project}/user/{user_id}/remove:
 *   delete:
 *     tags: [Proyectos]
 *     summary: Elimina un usuario de un proyecto
 *     description: Elimina un usuario de un proyecto
 *     parameters:
 *       - in: path
 *         name: project
 *         required: true
 *         description: ID del proyecto
 *       - in: path
 *         name: user_id
 *         required: true
 *         description: ID del usuario
 *     responses:
 *       200:
 *         description: Usuario eliminado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Estado de la operaci n
 */
projectsController.sharedProjectsUserRemove = async (req, res) => {
  // Verifica si el usuario proporcion&oacute; el email del usuario
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  // Obtiene el id del proyecto
  const project = req.params.project;
  const id = req.params.user_id;

  try {
    // Elimina al participante únicamente del proyecto indicado.
    const { rows } = await databasePool.query({
      text: `
        DELETE FROM public.proyectos_usuarios
        WHERE id = $1 AND proyecto_id = $2
        RETURNING *
      `,
      values: [
        id,
        project
      ]
    });

    if (!rows.length)
      return res.status(404).send({ message: "La persona no pertenece a este proyecto" });

    // Regresa el usuario eliminado
    return res.status(200).send({
      'status': 'Usuario eliminado'
    });

  } catch (error) {
    // Regresa un error en caso de que algo salga mal
    return res.status(400).send({ message: error.message });
  }
};

/**
 * Actualiza el rol de un usuario en un proyecto
 * @swagger
 * /projects/shared/{project}/user/{user_id}/update:
 *   post:
 *     tags: [Proyectos]
 *     summary: Actualiza el rol de un usuario en un proyecto
 *     description: Actualiza el rol de un usuario en un proyecto
 *     parameters:
 *       - in: path
 *         name: project
 *         required: true
 *         description: ID del proyecto
 *       - in: path
 *         name: user_id
 *         required: true
 *         description: ID del usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               project:
 *                 type: integer
 *                 description: ID del proyecto
 *               user_id:
 *                 type: integer
 *                 description: ID del usuario
 *               rol:
 *                 type: string
 *                 description: Rol del usuario en el proyecto (administrar, revisar, aporta, ver)
 *     responses:
 *       200:
 *         description: Usuario actualizado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   description: Estado de la operaci n
 * 
 */
projectsController.sharedProjectsUserUpdate = async (req, res) => {
  // Verifica si el usuario proporcion&oacute; el email del usuario
  if (!req.body.user_id)
    return res.status(400).send({ message: "Falta el email del usuario" });

  // Obtiene el id del proyecto y el id del usuario
  const project = req.params.project;
  const id = req.params.user_id;

  if (!PROJECT_ROLES.has(req.body.rol))
    return res.status(400).send({ message: "El permiso indicado no es válido" });

  try {
    // Actualiza el rol únicamente dentro del proyecto indicado.
    const { rows } = await databasePool.query({
      text: `
        UPDATE public.proyectos_usuarios
        SET rol = $1
        WHERE id = $2 AND proyecto_id = $3
        RETURNING *
      `,
      values: [
        req.body.rol,
        id,
        project
      ]
    });

    if (!rows.length)
      return res.status(404).send({ message: "La persona no pertenece a este proyecto" });

    // Regresa el usuario actualizado
    return res.status(200).send({
      'status': 'Usuario actualizado'
    });

  } catch (error) {
    // Regresa un error en caso de que algo salga mal
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

/**
 * Obtiene la lista de proyectos pendientes de revisión de un usuario
 * 
 * @swagger
 * /projects/reviewer/list:
 *   post:
 *     tags: [Proyectos]
 *     summary: Obtiene la lista de proyectos pendientes de revisi n de un usuario
 *     description: Obtiene la lista de proyectos pendientes de revisi n de un usuario
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string 
 *                 description: Correo electrónico del usuario
 *               status:
 *                 type: string 
 *                 description: Estado del proyecto
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: N  mero de proyectos pendientes
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID del proyecto
 *                       nombre:
 *                         type: string
 *                         description: Nombre del proyecto
 *                       ruta:
 *                         type: string
 *                         description: Ruta del proyecto
 *                       path_media_folder:
 *                         type: string
 *                         description: Ruta de la carpeta de medios del proyecto
 */
projectsController.reviewerProjects = async (req, res) => {
  try {
    const userEmail = req.userEmail;

    if (!userEmail) {
      return res.status(400).send({ message: "Correo electr nico faltante" });
    }

    const page = parseInt(req.body.page, 12) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    const status = req.body.status || '';

    const accessFilter = req.isLevantamientoAdmin
      ? ''
      : `AND (
          l.id_propietario = $4
          OR EXISTS (
            SELECT 1
            FROM public.proyectos_usuarios pu
            WHERE pu.proyecto_id = l.id
              AND LOWER(pu.correo) = $4
              AND pu.rol IN ('administrar', 'revisar')
          )
        )`;
    const countAccessFilter = accessFilter.replaceAll('$4', '$2');

    // El administrador global ve todos los proyectos; los demás conservan
    // el alcance concedido por propiedad o participación en cada proyecto.
    const query = `
      SELECT l.*,
            l.region AS ruta,
            CONCAT('apidev/', REPLACE(l.imagen,'./','')) AS path_media_folder,
            l.es_institucion,
            count(l2.id) as num_aportaciones
      FROM public.proyectos AS l
      LEFT JOIN public.levantamientos l2 on l2.id_proyecto = l.id
      WHERE l.status = $1
      ${accessFilter}
      GROUP BY l.id
      ORDER BY l.id DESC
      LIMIT  $2
      OFFSET $3
    `;

    // Obtiene el n  mero total de proyectos pendientes de revisi n de un usuario
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM public.proyectos AS l
      WHERE l.status = $1
      ${countAccessFilter}
    `;

    const [{ rows: proyectos }, { rows: countRows }] = await Promise.all([
      databasePool.query({
        text: query,
        values: req.isLevantamientoAdmin
          ? [status, limit, offset]
          : [status, limit, offset, userEmail]
      }),
      databasePool.query({
        text: countQuery,
        values: req.isLevantamientoAdmin ? [status] : [status, userEmail]
      })
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
    console.log(error)
    return res.status(400).send({ message: error.message });
  }
}

/**
 * @swagger
 * /projects/status/{id}:
 *   post:
 *     tags: [Proyectos]
 *     summary: "Actualizar el estado de un proyecto"
 *     description: "Actualizar el estado de un proyecto"
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         description: ID del proyecto a actualizar    
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               status:
 *                 type: string 
 *               report:
 *                 type: string 
 *                 description: Reporte del curador
 *               notificado:
 *                 type: boolean
 *                 description: Indica si se ha notificado al curador
 *               user_id:
 *                 type: string
 *                 description: ID del curador
 *     responses:
 *       200:
 *         description: "Proyecto actualizado"
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 */
projectsController.reviewerProjectsStatus = async (req, res) => {
  try {
    // Actualiza el estado de notificado de un levantamiento
    if (!req.body.status)
      return res.status(400).send({ message: "Estado faltante" });
    if (!PROJECT_STATUSES.has(req.body.status))
      return res.status(400).send({ message: "Estado de proyecto no válido" });

    // Valida que revisores no administradores sean propietarios o colaboradores autorizados del proyecto
    if (!req.isLevantamientoAdmin) {
      const { rows: authorizedRows } = await databasePool.query({
        text: `
          SELECT p.id
          FROM public.proyectos p
          WHERE p.id = $1
            AND (
              p.id_propietario = $2
              OR EXISTS (
                SELECT 1
                FROM public.proyectos_usuarios pu
                WHERE pu.proyecto_id = p.id
                  AND LOWER(pu.correo) = $2
                  AND pu.rol IN ('administrar', 'revisar')
              )
            )
          LIMIT 1
        `,
        values: [req.params.id, req.userEmail]
      });
      if (!authorizedRows.length)
        return res.status(403).send({ message: "No tienes permiso para revisar este proyecto" });
    }
    
    const values = [];
    const fields = [];
    let index = 1;

    values.push(req.body.status)
    fields.push(`status = $${index++}`)

    // Actualiza la privacidad y el curador según la resolución del proyecto.
    if (req.body.status === 'APROBADO') {
      fields.push('es_privada = false');
    } else if (req.body.status === 'EN REVISION' || req.body.status === 'RECHAZADO') {
      fields.push('es_privada = true');
    }

    if (['APROBADO', 'RECHAZADO'].includes(req.body.status)) {
      values.push(req.userEmail)
      fields.push(`id_curador = $${index++}`)

      values.push(new Date())
      fields.push(`fecha_aceptacion = $${index++}`)
    }

    if(req.body.report){
      values.push(req.body.report)
      fields.push(`comentario_curador = $${index++}`)
    }
    

    if(req.body.es_notificado){
      values.push(req.body.es_notificado)
      fields.push(`es_notificado = $${index++}`)
    }

    values.push(req.params.id)

    const query = `
      UPDATE public.proyectos
      SET ${fields.join(", ")}
      WHERE id = $${index}
      RETURNING id, status, es_privada
    `
    const updateSql = {
      text: query,
      values: values
    };

    // Ejecuta la consulta de actualizaci n
    const { rows } = await databasePool.query(updateSql);

    if (!rows.length)
      return res.status(404).send({ message: "El proyecto no existe" });

    // Devuelve una respuesta con el estado de la operaci n
    return res.status(200).send({
      status: "ok",
      message: "proyecto actualizado",
      proyecto: rows[0]
    });
  } catch (error) {
    // Devuelve una respuesta con el mensaje de error
    return res.status(400).send({ message: error.message });
  }
};

module.exports = projectsController;
