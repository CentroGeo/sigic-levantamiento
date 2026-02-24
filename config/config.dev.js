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
    email: {
        smtp: {
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT) || 465,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS,
            },
        },
        from: {
            name: process.env.SMTP_FROM_NAME,
            email: process.env.SMTP_FROM_EMAIL,
        }
    }
}

module.exports = config;
