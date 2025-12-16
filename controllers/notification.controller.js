const Sender = require('../helpers/Sender');
const { databasePool } = require('../postgres.db');
const EventEmitter = require('events');

const notificationController = {};
const emitter = new EventEmitter();

notificationController.projectsOwnershipNotification = async (req, res) => {  
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    
    const query = `
          SELECT l.nombre as title,
                l.id_propietario,
                l.id,
          FROM public.proyectos AS l
          INNER JOIN proyectos_usuarios pu ON l.id = pu.proyecto_id
          WHERE 
            pu.correo = '${userEmail}'
            and pu.es_notificado = true
            AND pu.rol IN ('administrar', 'revisar', 'aporta', 'ver')
          GROUP BY l.id
          ORDER BY l.id DESC
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
      console.log(error);
      return res.status(400).send({
        status: "Error",
        error: error,
        message: error.message
      });
    }
};

notificationController.projectsOwnershipNotificationDown = async (req, res) => {  
  if (!req.body.email)
    return res.status(400).send({ message: "Correo electrónico faltante" });
  
  const query = `
      UPDATE proyectos_usuarios pu
      SET es_notificado = FALSE
      FROM public.proyectos l
      WHERE l.id = pu.proyecto_id
        AND pu.correo = '${userEmail}'
        AND pu.es_notificado = TRUE
        AND pu.rol IN ('administrar', 'revisar', 'aporta', 'ver')
      returning *
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





notificationController.downloadOwnershipNotification = async (req, res) => {
	if (!req.body.email) return res.status(400).send({ message: "Correo electrónico faltante" });

	let query = `
		SELECT 
			l.*, l.nombre_descarga as title, i.nombre as nombre_propietario
		FROM public.descargas as l
		where l.usuario_id = '${req.body.email}' and l.es_notificado = true
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

notificationController.raisingOwnershipNotification = async (req, res) => {
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    let query = `
          SELECT l.*, l.nombre as title, CONCAT('apidev/', REPLACE(l.media_folder,'./','')) as path_media_folder
          from levantamientos l 
          where l.usuario_id = '${req.body.email}' and l.es_notificado = true
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

notificationController.raisingReviewerNotifications = async (req, res) => {

    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    let query = `
          SELECT l.*, l.nombre as title, CONCAT('apidev/', REPLACE(l.media_folder,'./','')) as path_media_folder
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
  

notificationController.projectsReviewerNotifications = async (req, res) => {
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    let query = `
          SELECT 
              l.*, 
              l.nombre as title, 
              l.region as ruta, CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder 
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

notificationController.notificationController = async (req, res) => {
  try {
    const updateSql = {
      text: `UPDATE public.levantamientos
                SET es_notificado = false, curador_notificado=false
                WHERE 
                  usuario_id = $1
                returning *`,
      values: [req.body.email]
    };

    const { rows } = await databasePool.query(updateSql);
    return res.status(200).send({
      status: "ok",
      message: "levantamiento actualizado"
    });
  } catch (error) {
    return res.status(400).send({ message: error.message });
  }
};


module.exports = notificationController;
