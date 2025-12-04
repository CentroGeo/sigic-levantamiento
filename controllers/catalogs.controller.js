const { databasePool } = require('../postgres.db');
const wellknown = require('wellknown');

//import { stringify } from "wellknown/wellknown.js";
const fs = require('fs');
const path = require('path');

const exif = require('exiftool');
const appRoot = require('app-root-path');

const miapptsilController = {};



/*********** Sección API levantamientos  **********/

miapptsilController.states = async (req, res) => {
	console.log("getMunicipios")
	
	let query = `
			SELECT ent.entidad_cvegeo, ent.entidad_nombre,
			ROUND(ST_XMin(ST_Envelope(ent.entidad_geom_4326))::numeric, 2) AS min_x,
			ROUND(ST_YMin(ST_Envelope(ent.entidad_geom_4326))::numeric, 2) AS min_y,
			ROUND(ST_XMax(ST_Envelope(ent.entidad_geom_4326))::numeric, 2) AS max_x,
			ROUND(ST_YMax(ST_Envelope(ent.entidad_geom_4326))::numeric, 2) AS max_y
			FROM dim_entidad ent
	`	
		try {
			const { rows } = await databasePool.query({
				text: query
			});

			return res.status(200).send({
				total: rows.length,
				states: rows
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

miapptsilController.municipalities = async (req, res) => {
	console.log("getMunicipios")
	
	let query = `
			select mun.entidad_cvegeo, mun.municipio_cvegeo, mun.municipio_nombre,
			ROUND(ST_XMin(ST_Envelope(mun.municipio_geom_4326))::numeric, 2) AS min_x,
			ROUND(ST_YMin(ST_Envelope(mun.municipio_geom_4326))::numeric, 2) AS min_y,
			ROUND(ST_XMax(ST_Envelope(mun.municipio_geom_4326))::numeric, 2) AS max_x,
			ROUND(ST_YMax(ST_Envelope(mun.municipio_geom_4326))::numeric, 2) AS max_y
			FROM dim_municipio mun		
			where mun.entidad_cvegeo = $1	
	`	
		try {
			const { rows } = await databasePool.query({
				text: query,
				values: [req.params.id]
			});

			return res.status(200).send({
				total: rows.length,
				municipios: rows
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

module.exports = miapptsilController;
