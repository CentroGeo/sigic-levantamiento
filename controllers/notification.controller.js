const Sender = require('../helpers/Sender');
const { databasePool } = require('../postgres.db');
const EventEmitter = require('events');

const notificationController = {};
const emitter = new EventEmitter();

/**
 * Obtiene el rol de un usuario en un proyecto
 * 
 * @swagger
 * /notification/user/rol:
 *   get:
 *     tags: [Notificaciones]
 *     summary: Obtiene el rol de un usuario en un proyecto
 *     description: Obtiene el rol de un usuario en un proyecto
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
 *                   description: N  mero de proyectos en los que el usuario tiene acceso y no ha sido notificado
 *                 is_reviewer:
 *                   type: boolean
 *                   description: Indica si el usuario es revisor o no
 */
notificationController.getRolUser = async (req, res) => {
  try {
    // Verifica si el usuario proporcion  el email del usuario
    const userEmail = req.body.email;

    if (!userEmail) {
      return res.status(400).send({ message: "Correo electr nico faltante" });
    }

    // Obtiene el rol del usuario en la tabla proyectos_usuarios
    const query = `
      SELECT COUNT(*) AS total
      FROM public.proyectos AS l
      INNER JOIN proyectos_usuarios pu ON l.id = pu.proyecto_id
      WHERE 
        pu.correo = '${userEmail}'
        AND pu.rol IN ('administrar', 'revisar')
    `;

    const { rows } = await databasePool.query({
      text: query
    });
    
    // Obtiene el n  mero de proyectos en los que el usuario tiene acceso y no ha sido notificado
    const total = rows[0].total;
    const is_reviewer = total > 0;

    return res.status(200).send({
      total,
      is_reviewer
    });
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
}  

/**
 * Obtiene la lista de proyectos en los que el usuario tiene acceso y no ha sido notificado
 *
 * @swagger
 * /notification/projects/ownership:
 *   get:
 *     tags: [Notificaciones]
 *     summary: Obtiene la lista de proyectos en los que el usuario tiene acceso y no ha sido notificado
 *     description: Obtiene la lista de proyectos en los que el usuario tiene acceso y no ha sido notificado
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
 *                 description: L mite de proyectos por p gina
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
 *                   description: N  mero de proyectos en los que el usuario tiene acceso y no ha sido notificado
 *                 projects:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       title:
 *                         type: string
 *                         description: T tulo del proyecto
 *                       id_propietario:
 *                         type: integer
 *                         description: ID del propietario del proyecto
 *                       id:
 *                         type: integer
 *                         description: ID del proyecto
 */
notificationController.projectsOwnershipNotification = async (req, res) => {
  /**
   * Verifica si el usuario proporcion  el email del usuario
   */
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electr nico faltante" });
  
  const userEmail = req.body.email;

  /**
   * Obtiene la lista de proyectos en los que el usuario tiene acceso y no ha sido notificado
   */
  const query = `
    SELECT l.nombre as title,
          l.id_propietario,
          l.id
    FROM public.proyectos AS l
    INNER JOIN proyectos_usuarios pu ON l.id = pu.proyecto_id
    WHERE 
      pu.correo = '${userEmail}'
      AND pu.es_notificado = true
      AND pu.rol IN ('administrar', 'revisar', 'aporta', 'ver')
    GROUP BY l.id
    ORDER BY l.id DESC
  `;

  try {
    /**
     * Ejecuta la consulta y devuelve el resultado
     */
    const { rows } = await databasePool.query({
      text: query
    });
  
    return res.status(200).send({
      total: rows.length,
      projects: rows
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
 * Desactiva las notificaciones de los proyectos en los que el usuario tiene acceso
 * @swagger
 * /notification/projects/ownership/down:
 *   post:
 *     tags: [Notificaciones]
 *     summary: Desactiva las notificaciones de los proyectos en los que el usuario tiene acceso
 *     description: Desactiva las notificaciones de los proyectos en los que el usuario tiene acceso
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
 *                 description: L mite de proyectos por p gina  
 * 
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
 *                 projects:
 *                   type: integer
 *                   description: N  mero de proyectos en los que las notificaciones fueron desactivadas
 */
notificationController.projectsOwnershipNotificationDown = async (req, res) => {
  // Verifica si el usuario proporcion  el email del usuario
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electr nico faltante" });
  
  const userEmail = req.body.email;

  // Desactiva las notificaciones de los proyectos en los que el usuario tiene acceso
  const query = `
    UPDATE public.proyectos_usuarios pu
    SET es_notificado = FALSE
    FROM public.proyectos l
    WHERE l.id = pu.proyecto_id
      AND pu.correo = '${userEmail}'
      AND pu.es_notificado = TRUE
      AND pu.rol IN ('administrar', 'revisar', 'aporta', 'ver')
    RETURNING *
  `;

  try {
    const { rows } = await databasePool.query({
      text: query
    });

    return res.status(200).send({
      status: "Notificaciones desactivadas",
      projects: rows.length
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
 * /notification/projects/owner:
 *   post:
 *     tags: [Notificaciones]
 *     summary: Obtener lista de proyectos propios de un usuario que tengan notificaciones pendientes
 *     description: Obtener lista de proyectos propios de un usuario que tengan notificaciones pendientes
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
 * 
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
 *                   description: N  mero de proyectos que tengan notificaciones pendientes
 *                 proyectos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                         description: Estado del proyecto
 *                       total:
 *                         type: integer
 *                         description: N  mero de notificaciones pendientes en el proyecto
 */
notificationController.raisingOwnershipNotification = async (req, res) => {
  // Verifica si el usuario proporcion  el email del usuario
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electr nico faltante" });

  const userEmail = req.body.email;

  // Obtener lista de proyectos propios de un usuario que tengan notificaciones pendientes
  const query = `
        SELECT distinct l.status, count(*) as total
        from levantamientos l 
        where l.usuario_id = '${userEmail}' and l.status = '${req.body.status}' and l.es_notificado = true
        group by l.status
    `;

  try {
    const { rows } = await databasePool.query({
      text: query
    });

    return res.status(200).send({
      total: rows.length,
      proyectos: rows
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
 * Desactiva las notificaciones de los proyectos propios de un usuario que tengan un estado en particular
 * @swagger
 * /notification/projects/ownership/down:
 *   post:
 *     tags: [Notificaciones]
 *     summary: Desactiva las notificaciones de los proyectos propios de un usuario que tengan un estado en particular
 *     description: Desactiva las notificaciones de los proyectos propios de un usuario que tengan un estado en particular
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
 *               status:
 *                 type: string 
 *                 description: Estado del proyecto
 * 
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
 *                   description: N  mero de proyectos que tengan notificaciones pendientes
 *                 proyectos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                         description: Estado del proyecto
 *                       total:
 *                         type: integer
 *                         description: N  mero de notificaciones pendientes en el proyecto
 */
notificationController.raisingOwnershipNotificationDown = async (req, res) => {
  // Verifica si el usuario proporcion  el email del usuario
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electronico faltante" });

  const userEmail = req.body.email;

  // Desactiva las notificaciones de los proyectos propios de un usuario que tengan un estado en particular
  const query = `
      UPDATE levantamientos l
      SET es_notificado = FALSE
      WHERE l.usuario_id = '${userEmail}'
        AND l.status = '${req.body.status}'
        AND l.es_notificado = TRUE
      returning *
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
 * Obtiene la lista de notificaciones de descargas pendientes de un usuario
 * 
 * @swagger
 * /notification/downloads/ownership:
 *   post:
 *     tags: [Notificaciones]
 *     summary: Obtiene la lista de notificaciones de descargas pendientes de un usuario
 *     description: Obtiene la lista de notificaciones de descargas pendientes de un usuario
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
 *                   description: N  mero de notificaciones pendientes
 *                 list:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                         description: Estado de la notificaci n
 *                       total:
 *                         type: integer
 *                         description: N  mero de notificaciones pendientes en el estado
 */
notificationController.downloadOwnershipNotification = async (req, res) => {
	if (!req.body.email) return res.status(400).send({ message: "Correo electr nico faltante" });

	let query = `
    SELECT distinct l.status, count(*) as total
		FROM public.Descargas as l
		where l.usuario_id = '${req.body.email}' and l.es_notificado = true
    group by l.status
	`

	try {
		const { rows } = await databasePool.query({
			text: query
		});

		return res.status(200).send({
			total: rows.length,
			list: rows
		});
	} catch (error) {
		console.log(error)
		return res.status(400).send({
			status: 'Error',
			error: error,
			message: error.message

		});
	}

}

/**
 * Desactiva las notificaciones de descargas pendientes de un usuario
 * 
 * @swagger
 * /notification/downloads/ownership/down:
 *   post:
 *     tags: [Notificaciones]
 *     summary: Desactiva las notificaciones de descargas pendientes de un usuario
 *     description: Desactiva las notificaciones de descargas pendientes de un usuario
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
 *               status:
 *                 type: string 
 *                 description: Estado de la notificaci n
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
 *                   description: N  mero de notificaciones pendientes
 *                 list:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       status:
 *                         type: string
 *                         description: Estado de la notificaci n
 *                       total:
 *                         type: integer
 *                         description: N  mero de notificaciones pendientes en el estado
 */
/**
 * Desactiva las notificaciones de descargas pendientes de un usuario
 * @param {object} req - Request object
 * @param {object} res - Response object
 * @returns {Promise<object>} - Promise with response object
 */
notificationController.downloadOwnershipNotificationDown = async (req, res) => {
	if (!req.body.email) return res.status(400).send({ message: "Correo electr nico faltante" });

	// Desactiva las notificaciones de descargas pendientes de un usuario
	const query = `
		UPDATE descargas l
    SET es_notificado = FALSE
    WHERE l.usuario_id = '${req.body.email}'
      AND l.status = '${req.body.status}'
      AND l.es_notificado = TRUE
    returning *
	`;

	try {
		const { rows } = await databasePool.query({
			text: query
		});

		return res.status(200).send({
			total: rows.length,
			descargas: rows
		});
	} catch (error) {
		console.log(error)
		return res.status(400).send({
			status: 'Error',
			error: error,
			message: error.message

		});
	}

}

/**
 * Obtiene la lista de levantamientos pendientes de revisi n de un usuario
 * @swagger
 * /notification/raising/reviewer:
 *   get:
 *     tags: [Notificaciones]
 *     summary: Obtiene la lista de levantamientos pendientes de revisi n de un usuario
 *     description: Obtiene la lista de levantamientos pendientes de revisi n de un usuario
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
 *               status:
 *                 type: string 
 *                 description: Estado del levantamiento
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
 *                   description: N  mero de levantamientos pendientes
 *                 levantamientos:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: integer
 *                         description: ID del levantamiento
 *                       nombre:
 *                         type: string
 *                         description: Nombre del levantamiento
 *                       path_media_folder:
 *                         type: string
 *                         description: Ruta de la carpeta de medios del levantamiento
 */
notificationController.raisingReviewerNotifications = async (req, res) => {

    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    let query = `
          SELECT 
              l.*, 
              l.nombre as title, 
              CONCAT('apidev/', REPLACE(l.media_folder,'./','')) as path_media_folder
          from levantamientos l 
          where l.id_curador = '${req.body.email}' and l.curador_notificado = true
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
      return res.status(400).send({
        status: "Error",
        error: error,
        message: error.message
      });
    }
};
  

/**
 * Obtiene la lista de proyectos pendientes de revisi n de un usuario
 * @swagger
 * /notification/projects/reviewer:
 *   get:
 *     tags: [Notificaciones]
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
 *                 description: Correo electr&oacute;nico del usuario
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
notificationController.projectsReviewerNotifications = async (req, res) => {
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    // Obtiene la lista de proyectos pendientes de revisi n de un usuario
    let query = `
          SELECT 
              l.*, 
              l.nombre as title, 
              l.region as ruta, 
              CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder 
          from proyectos l
          where l.id_curador = '${req.body.email}' and l.curador_notificado = true
      `;
  
    try {
      const { rows } = await databasePool.query({
        text: query
      });
  
      return res.status(200).send({
        total: rows.length,
        projects: rows
      });
    } catch (error) {
      return res.status(400).send({
        status: "Error",
        error: error,
        message: error.message
      });
    }
};

/**
 * Actualiza el estado de notificado de un levantamiento
 * @swagger
 * /notification/levantamiento/curador/notificado:
 *   put:
 *     tags: [Notificaciones]
 *     summary: Actualiza el estado de notificado de un levantamiento
 *     description: Actualiza el estado de notificado de un levantamiento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string 
 *                 description: Correo electr&oacute;nico del curador
 *               status:
 *                 type: string 
 *                 description: Estado de la notificaci n
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
 *                   description: Estado de la operaci n
 *                 message:
 *                   type: string
 *                   description: Mensaje de respuesta
 */
notificationController.notificationController = async (req, res) => {
  try {
    // Actualiza el estado de notificado de un levantamiento
    const updateSql = {
      text: `UPDATE public.levantamientos
                SET es_notificado = false, curador_notificado=false
                WHERE 
                  usuario_id = $1
                returning *`,
      values: [req.body.email]
    };

    // Ejecuta la consulta de actualizaci n
    const { rows } = await databasePool.query(updateSql);

    // Devuelve una respuesta con el estado de la operaci n
    return res.status(200).send({
      status: "ok",
      message: "levantamiento actualizado"
    });
  } catch (error) {
    // Devuelve una respuesta con el mensaje de error
    return res.status(400).send({ message: error.message });
  }
};


module.exports = notificationController;
