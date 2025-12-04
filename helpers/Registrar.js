const { databasePool } = require('../postgres.db');

class Registrar {

    constructor() {

    }

    async register(user, db_id) {
        user.db_id = db_id;
		
		return await this._toUser(user);
    }

    updateFCMtoken(user) {
        let text = "";

        switch (user.type) {
            case 'administrador':
			case 'liderproyecto':
			case 'curador':
			case 'voluntario':
			case 'registrante':			
                text = `
                    UPDATE public.devices AS device
                    SET  fcm_token = $1
                    FROM (
                        SELECT device_id FROM public.users_info
                        WHERE user_id = $2
                    ) AS type_user
                    WHERE device.id=type_user.device_id`;
                break;	
            default:
                throw new Error("Incorrect user type");
        }

        return databasePool.query({
            text: text,
            values: [ user.fcmToken, user.id ]
        });
    }



    async _toUser(user) {
        const { rows } = await databasePool.query({
            text: `INSERT INTO
                public.devices(id, os, fcm_token)
                VALUES (default, null, null)
                returning *`
            }
        );

        return databasePool.query({
            text: `INSERT INTO
                public.users_info(id, user_id, device_id, nombre, apellido)
                VALUES (default, $1, $2, $3, $4)`,
            values: [
			    //defauklt id (serial auntoincrement)
                user.db_id, //uuid
				rows[0].id, //device id
				user.name,
				user.lastname
            ]
        });
    }

    verify(user) {
        //if (!user.type) throw new Error("Falta tipo de usuario");
		if (!user.name) throw new Error("falta el campo nombre");
		if (!user.lastname) throw new Error("falta el campo apellido");
        if (!user.email) throw new Error("falta el campo correo");
        if (!user.password) throw new Error("Falta el campo contraseña");
    }
}

module.exports = Registrar;
