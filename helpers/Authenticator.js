const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const { databasePool } = require('../postgres.db');
const config = require('../config/config.dev');

class Authenticator {
    constructor() {

    }

    hashPassword(password) {
        return bcrypt.hashSync(password, bcrypt.genSaltSync(config.auth.saltRounds))
    }

    comparePassword(hashPassword, password) {
        return bcrypt.compareSync(password, hashPassword);
    }

    generateToken(id, isSavedLogin=false) {
        const token = jwt.sign({
            userId: id
        },
            config.auth.secret, isSavedLogin ? {}:{ expiresIn: '7d' }
        );

        return token;
    }

    async isCorrectType(userId, userType) {
        let response;

        switch (userType) {
            case 'administrador':
			case 'liderproyecto':
			case 'curador':
			case 'voluntario':
			case 'registrante':	
                response = await databasePool.query({
                    text: 'SELECT * FROM public.users_info WHERE user_id = $1',
                    values: [ userId ]
                });
                break;			
            default:
                throw new Error("Incorrect user type");
        }

        return !!response.rows[0];
    }

    async verifyToken(req, res, next) {
        const token = req.headers['x-access-token'];

        if(!token) {
            return res.status(400).send({
                name: "InvalidTokenError",
                message: 'Token is not provided'
            });
        }

        try {
            const decoded = await jwt.verify(token, config.auth.secret);
            const text = 'SELECT * FROM public.users WHERE id = $1 and inactive = false';

            const { rows } = await databasePool.query(text, [decoded.userId]);

            if(!rows[0]) {
                return res.status(401).send({
                    name: "InvalidTokenError",
                    message: 'The token you provided is invalid'
                });
            }

            req.user = { 
                id: decoded.userId,
                email: rows[0].email
            };
            next();
        } catch(error) {
            if (error.name === 'TokenExpiredError') {
                console.log("delete token notification");
            }
            return res.status(401).send(error);
        }
    }
}

module.exports = Authenticator;
