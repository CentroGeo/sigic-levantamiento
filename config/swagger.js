const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'API Pública',
      version: '1.0.0',
      description: 'Documentación de la API',
    },
  },
  apis: ['./routes/*.js'],
};

export default options;