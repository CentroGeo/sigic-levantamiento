require('dotenv').config();

const config = {
    app: {
        domine: 'http://localhost:3002'
    },
	PORT: process.env.PORT,
    postgres: {
        database: {
            credentials: {
                database: process.env.PG_DATABASE,
                host: process.env.PG_HOST,
                port: process.env.PG_PORT,
                user: process.env.PG_USER,
                password: process.env.PG_PASSWORD,
            }
        }
    },
}

module.exports = config;
