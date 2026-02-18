const express = require('express');
const morgan = require('morgan');
const path = require('path');
const cors = require("cors");
const swaggerJSDoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');


const options = {
    definition: {
      openapi: '3.0.0',
      info: {
        title: 'API Pública',
        version: '1.0.0',
        description: 'Documentación de la API',
      },
    },
    apis: ['./controllers/*.js'],
  };
  
const swaggerSpec = swaggerJSDoc(options);
const app = express();
const { validarToken } = require('./middleware/auth');
//app.use(validarToken);

// Databases
const config = require('./config/config.dev');
const postgres = require('./postgres.db');
postgres.start(config.postgres.database);

// Settings
app.set('port', config.PORT);

// Middlewares
app.use(morgan('dev'));
app.use(cors());

app.use(express.json({limit:'500mb'}));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/schema/swagger-ui/', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

app.use('/uploads', express.static('uploads'));
app.use('/downloads', express.static('downloads'));

app.use('/projects', require('./routes/projects.routes'));
app.use('/raising', require('./routes/levantamientos.routes'));
app.use('/downloads', require('./routes/downloads.routes'));
app.use('/catalogs', require('./routes/catalogs.routes.js'));
app.use('/notifications', require('./routes/notification.routes'));

// api para universidades
app.use('/', require('./routes/edu.routes'));
app.use('/', require('./routes/eduName.routes'));
app.use('/', require('./routes/eduNameStrict.routes'));

// Static files
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist', 'frontend')));

const server = require('http').createServer(app);
// const { startListen } = require('./controllers/socket.controller.js');

// startListen(server);
server.listen(app.get('port'));
console.log("listening port: "+config.PORT)

const moment = require('moment')
require('moment/locale/es')

