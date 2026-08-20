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
 * Devuelve el detalle visible de un proyecto público, su resumen de aportes y
 * las coordenadas publicables que alimentan el mapa.
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
 * Devuelve la ficha pública de un aporte aprobado. La consulta deliberadamente
 * omite ubicación, datos personales y archivos multimedia.
 * @swagger
 * /projects/public/{id}:
 *   get:
 *     tags: [Proyectos]
 *     summary: Obtener el detalle de un proyecto público
 *     description: Devuelve la información general, el resumen de aportes y las coordenadas públicas que alimentan el mapa.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del proyecto
 *     responses:
 *       200:
 *         description: Detalle del proyecto público
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 proyecto:
 *                   type: object
 *                 resumen:
 *                   type: object
 *                   properties:
 *                     total:
 *                       type: integer
 *                     aprobados:
 *                       type: integer
 *                     revision:
 *                       type: integer
 *                     rechazados:
 *                       type: integer
 *                 aportes:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                       latitud:
 *                         type: number
 *                       longitud:
 *                         type: number
 *       400:
 *         description: Identificador inválido
 *       404:
 *         description: Proyecto público no encontrado
 *       500:
 *         description: Error al cargar el proyecto
 */
projectsController.publicProjectDetail = async (req, res) => {
  try {
    const projectId = Number(req.params.id);

    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).send({ message: "ID de proyecto inválido" });
    }

    const [{ rows: projects }, { rows: summaryRows }, { rows: contributions }] =
      await Promise.all([
        databasePool.query({
          text: `
            SELECT p.*,
              p.region AS ruta,
              CONCAT('apidev/', REPLACE(p.imagen, './', '')) AS path_media_folder
            FROM public.proyectos p
            WHERE p.id = $1
              AND p.es_privada = false
              AND p.activo = true
            LIMIT 1
          `,
          values: [projectId],
        }),
        databasePool.query({
          text: `
            SELECT
              COUNT(*)::integer AS total,
              COUNT(*) FILTER (WHERE status = 'APROBADO')::integer AS aprobados,
              COUNT(*) FILTER (WHERE status IN ('EN REVISION', 'EN REVISIÓN'))::integer AS revision,
              COUNT(*) FILTER (WHERE status = 'RECHAZADO')::integer AS rechazados
            FROM public.levantamientos
            WHERE id_proyecto = $1
          `,
          values: [projectId],
        }),
        databasePool.query({
          text: `
            SELECT id, latitud, longitud
            FROM public.levantamientos
            WHERE id_proyecto = $1
              AND status = 'APROBADO'
              AND COALESCE(ubicacion_sensible, false) = false
              AND COALESCE(ocultar_ficha, false) = false
              AND latitud BETWEEN -90 AND 90
              AND longitud BETWEEN -180 AND 180
          `,
          values: [projectId],
        }),
      ]);

    if (!projects.length) {
      return res.status(404).send({ message: "Proyecto público no encontrado" });
    }

    return res.status(200).send({
      proyecto: projects[0],
      resumen: summaryRows[0],
      aportes: contributions,
    });
  } catch (error) {
    return res.status(500).send({ message: "No fue posible cargar el proyecto público" });
  }
};

/**
 * @swagger
 * /projects/public/{id}/contributions/{contributionId}:
 *   get:
 *     tags: [Proyectos]
 *     summary: Obtener la ficha pública de un aporte
 *     description: Devuelve respuestas y multimedia válida de un aporte aprobado y visible. No expone coordenadas, datos personales ni rutas internas.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del proyecto
 *       - in: path
 *         name: contributionId
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: Identificador del aporte
 *     responses:
 *       200:
 *         description: Ficha pública del aporte
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 fecha:
 *                   type: string
 *                   format: date-time
 *                   nullable: true
 *                 multimedia:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       tipo:
 *                         type: string
 *                         enum: [image, audio, video]
 *                       mime:
 *                         type: string
 *                       url:
 *                         type: string
 *                       descripcion:
 *                         type: string
 *                 respuestas:
 *                   type: array
 *                   items:
 *                     type: object
 *       400:
 *         description: Identificador inválido
 *       404:
 *         description: Ficha pública no encontrada
 *       500:
 *         description: Error al cargar la ficha
 */
projectsController.publicContributionDetail = async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const contributionId = Number(req.params.contributionId);

    if (
      !Number.isInteger(projectId) ||
      projectId <= 0 ||
      !Number.isInteger(contributionId) ||
      contributionId <= 0
    ) {
      return res.status(400).send({ message: "Identificador inválido" });
    }

    const { rows } = await databasePool.query({
      text: `
        SELECT l.id, l.fecha_levantamiento, l.respuestas_ficha::json AS respuestas_ficha,
          l.media_array
        FROM public.levantamientos l
        INNER JOIN public.proyectos p ON p.id = l.id_proyecto
        WHERE l.id = $1
          AND l.id_proyecto = $2
          AND l.status = 'APROBADO'
          AND COALESCE(l.ocultar_ficha, false) = false
          AND p.es_privada = false
          AND p.activo = true
        LIMIT 1
      `,
      values: [contributionId, projectId],
    });

    if (!rows.length) {
      return res.status(404).send({ message: "Ficha pública no encontrada" });
    }

    const rawAnswers = rows[0].respuestas_ficha;
    const answers = rawAnswers && typeof rawAnswers === "object" ? Object.values(rawAnswers) : [];
    const publicAnswers = answers.filter(
      (answer) => answer && String(answer.tipo || "").toLowerCase() !== "multimedia"
    );
    const multimediaQuestions = answers.filter(
      (answer) => answer && String(answer.tipo || "").toLowerCase() === "multimedia"
    );

    let mediaFiles = [];
    try {
      mediaFiles = Array.isArray(rows[0].media_array)
        ? rows[0].media_array
        : JSON.parse(rows[0].media_array || "[]");
    } catch {
      mediaFiles = [];
    }

    const allowedMimeType = /^(image\/(jpeg|png|webp|gif)|audio\/(mpeg|mp4|ogg|wav|webm)|video\/(mp4|webm|ogg))$/i;
    const publicMedia = mediaFiles.reduce((result, file, index) => {
      const mimeType = String(file?.mimetype || file?.mimeType || "").toLowerCase();
      const normalizedPath = String(file?.path || "")
        .replaceAll("\\", "/")
        .replace(/^\.\//, "")
        .replace(/\/{2,}/g, "/");

      if (
        !allowedMimeType.test(mimeType) ||
        !normalizedPath.startsWith("uploads/levantamientos/") ||
        normalizedPath.includes("..") ||
        !fs.existsSync(path.resolve(normalizedPath))
      ) {
        return result;
      }

      const question = multimediaQuestions[index];
      result.push({
        tipo: mimeType.split("/")[0],
        mime: mimeType,
        url: `/${normalizedPath}`,
        descripcion:
          question?.pregunta || question?.instrucciones || `Evidencia multimedia ${index + 1}`,
      });
      return result;
    }, []);

    return res.status(200).send({
      id: rows[0].id,
      fecha: rows[0].fecha_levantamiento,
      multimedia: publicMedia,
      respuestas: publicAnswers,
    });
  } catch (error) {
    return res.status(500).send({ message: "No fue posible cargar la ficha del aporte" });
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
