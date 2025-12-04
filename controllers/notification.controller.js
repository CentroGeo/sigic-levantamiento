const Sender = require('../helpers/Sender');
const { databasePool } = require('../postgres.db');
const alertaController = require('./alerta.controller');
const EventEmitter = require('events');

const notificationController = {};
const emitter = new EventEmitter();

notificationController.downloadOwnershipNotification = async (req, res) => {
	if (!req.body.email) return res.status(400).send({ message: "Correo electrónico faltante" });

	let query = `
		SELECT 
			l.*, l.nombre_descarga as title, u.email, i.nombre as nombre_propietario, i.apellido as apellido_propietario,
			uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador
		FROM public.descargas as l
    inner join users u on l.usuario_id = u.email
    inner join users_info i on u.id = i.user_id
    left join users uc on l.id_curador = uc.email
    LEFT join users_info ic on uc.id = ic.user_id
		where u.email = '${req.body.email}' and l.es_notificado = true
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
          SELECT l.*, l.nombre as title, CONCAT('apidev/', REPLACE(l.media_folder,'./','')) as path_media_folder, u.email, i.nombre, i.apellido, uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador
          from levantamientos l 
          inner join users u on l.usuario_id = u.email
          inner join users_info i on u.id = i.user_id
          left join users uc on l.id_curador = uc.email
          LEFT join users_info ic on uc.id = ic.user_id
          where u.email = '${req.body.email}' and l.es_notificado = true
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

notificationController.projectsOwnershipNotification = async (req, res) => {  
    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    let query = `
          SELECT 
              l.*, 
              l.nombre as title, 
              u.email, i.nombre as nombre_propietario, i.apellido as apellido_propietario, uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador, 
              l.region as ruta, CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder 
          from proyectos l 
          inner join users u on l.id_propietario = u.email
          inner join users_info i on u.id = i.user_id
          left join users uc on l.id_curador = uc.email
          left join users_info ic on uc.id = ic.user_id
          where u.email = '${req.body.email}' and l.es_notificado = true
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

notificationController.raisingReviewerNotifications = async (req, res) => {

    if (!req.body.email)
      return res.status(400).send({ message: "Correo electrónico faltante" });
  
    let query = `
          SELECT l.*, l.nombre as title, CONCAT('apidev/', REPLACE(l.media_folder,'./','')) as path_media_folder, u.email, i.nombre, i.apellido, uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador
          from levantamientos l 
          inner join users u on l.usuario_id = u.email
		  inner join users_info i on u.id = i.user_id
		  left join users uc on l.id_curador = uc.email
		  left join users_info ic on uc.id = ic.user_id
          where uc.email = '${req.body.email}' and l.curador_notificado = true
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
              u.email, i.nombre as nombre_propietario, i.apellido as apellido_propietario, uc.email as email_curador, ic.nombre as nombre_curador, ic.apellido as apellido_curador, 
              l.region as ruta, CONCAT('apidev/', REPLACE(l.imagen,'./','')) as path_media_folder 
          from proyectos l 
          left join users u on l.id_propietario = u.id
          left join users_info i on l.id_propietario = i.user_id
          left join users uc on l.id_curador = uc.id
          left join users_info ic on l.id_curador = ic.user_id
          where uc.email = '${req.body.email}' and l.curador_notificado = true
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
  
module.exports = notificationController;
