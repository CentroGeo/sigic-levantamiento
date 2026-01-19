'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    // Enable PostGIS extension
    await queryInterface.sequelize.query('CREATE EXTENSION IF NOT EXISTS postgis;');

    // Table: descargas
    await queryInterface.createTable('descargas', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      nombre_descarga: {
        type: Sequelize.STRING
      },
      descripcion: {
        type: Sequelize.TEXT
      },
      usuario_id: {
        type: Sequelize.TEXT
      },
      fecha_solicitud: {
        type: Sequelize.DATE
      },
      file_path: {
        type: Sequelize.TEXT
      },
      status: {
        type: Sequelize.STRING
      },
      fecha_aceptacion: {
        type: Sequelize.DATE
      },
      id_curador: {
        type: Sequelize.TEXT
      },
      comentario_curador: {
        type: Sequelize.TEXT
      },
      es_notificado: {
        type: Sequelize.BOOLEAN
      },
      id_proyecto: {
        type: Sequelize.BIGINT
      },
    });

    // Table: devices
    await queryInterface.createTable('devices', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      os: {
        type: Sequelize.STRING(25)
      },
      fcm_token: {
        type: Sequelize.STRING(200)
      },
      last_position: {
        type: Sequelize.GEOMETRY
      },
      last_date: {
        type: Sequelize.DATE
      }
    });

    // Table: dim_entidad
    await queryInterface.createTable('dim_entidad', {
      entidad_cvegeo: {
        type: Sequelize.STRING,
        primaryKey: true,
        allowNull: false
      },
      entidad_geom_4326: {
        type: Sequelize.GEOMETRY
      },
      entidad_nombre: {
        type: Sequelize.STRING(50)
      },
      entidad_geom_6362: {
        type: Sequelize.STRING
      },
      entidad_sin_geom: {
        type: Sequelize.BOOLEAN
      }
    });

    // Table: dim_localidad_urbana
    await queryInterface.createTable('dim_localidad_urbana', {
      entidad_cvegeo: {
        type: Sequelize.CHAR(2)
      },
      municipio_cvegeo: {
        type: Sequelize.CHAR(5)
      },
      localidad_urbana_cvegeo: {
        type: Sequelize.CHAR(9)
      },
      localidad_urbana_nombre: {
        type: Sequelize.STRING(100)
      },
      localidad_urbana_geom_6362: {
        type: Sequelize.GEOMETRY
      },
      localidad_urbana_geom_4326: {
        type: Sequelize.GEOMETRY
      },
      // Skipping tsvector as it's specific to PG full text search and hard to map generic types without raw syntax,
      // but creating it as specific column type is possible.
      localidad_urbana_nombre_ts: {
        type: 'tsvector' 
      }
    });

    // Table: dim_municipio
    await queryInterface.createTable('dim_municipio', {
      entidad_cvegeo: {
        type: Sequelize.CHAR(2)
      },
      municipio_cvegeo: {
        type: Sequelize.CHAR(5)
      },
      municipio_nombre: {
        type: Sequelize.STRING(100)
      },
      municipio_geom_6362: {
        type: Sequelize.GEOMETRY('MultiPolygon', 6362)
      },
      municipio_geom_4326: {
        type: Sequelize.GEOMETRY('MultiPolygon', 4326)
      },
      municipio_sin_geom: {
        type: Sequelize.BOOLEAN
      },
      municipio_nombre_ts: {
        type: 'tsvector'
      }
    });

    // Table: ficha_preguntas
    await queryInterface.createTable('ficha_preguntas', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      id_ficha_template: {
        type: Sequelize.BIGINT
      },
      id_pregunta: {
        type: Sequelize.BIGINT
      },
      tipo_pregunta: {
        type: Sequelize.STRING
      },
      texto_pregunta: {
        type: Sequelize.TEXT
      },
      opciones_pregunta: {
        type: Sequelize.ARRAY(Sequelize.STRING)
      }
    });

    // Table: ficha_respuestas
    await queryInterface.createTable('ficha_respuestas', {
      id_levantamiento: {
        type: Sequelize.BIGINT
      },
      id_pregunta: {
        type: Sequelize.BIGINT
      },
      respuesta: {
        type: Sequelize.TEXT
      }
    });

    // Table: ficha_template
    await queryInterface.createTable('ficha_template', {
      id_ficha_template: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      id_cat_principal: {
        type: Sequelize.BIGINT
      },
      nombre_template: {
        type: Sequelize.STRING
      },
      ids_cat_secundaria: {
        type: Sequelize.ARRAY(Sequelize.BIGINT)
      },
      template_json: {
        type: Sequelize.TEXT
      }
    });

    // Table: fichas_templates
    await queryInterface.createTable('fichas_templates', {
      id_ficha_template: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      id_cat_principal: {
        type: Sequelize.BIGINT,
        allowNull: false
      },
      nombre_template: {
        type: Sequelize.STRING,
        allowNull: false
      },
      existente: {
        type: Sequelize.BOOLEAN
      },
      template_json: {
        type: Sequelize.TEXT
      }
    });

    // Table: guest_user
    await queryInterface.createTable('guest_user', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      email: {
        type: Sequelize.STRING(255),
        allowNull: false,
        unique: true
      },
      category: {
        type: Sequelize.INTEGER,
        allowNull: false
      },
      active: {
        type: Sequelize.BOOLEAN,
        allowNull: false
      },
      email_created: {
        type: Sequelize.STRING,
        allowNull: false
      },
      created: {
        type: Sequelize.DATEONLY,
        allowNull: false,
        defaultValue: Sequelize.fn('NOW') 
      }
    });

    // Table: levantamientos
    await queryInterface.createTable('levantamientos', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      id_cat_principal: {
        type: Sequelize.BIGINT
      },
      id_cat_secundaria: {
        type: Sequelize.BIGINT
      },
      usuario_id: {
        type: Sequelize.TEXT
      },
      nombre: {
        type: Sequelize.STRING
      },
      fecha_guardado: {
        type: Sequelize.DATE
      },
      fecha_levantamiento: {
        type: Sequelize.DATE
      },
      geometries_text: {
        type: Sequelize.TEXT
      },
      media_folder: {
        type: Sequelize.TEXT
      },
      fuente: {
        type: Sequelize.STRING
      },
      media_metadata: {
        type: Sequelize.JSON
      },
      latitud: {
        type: Sequelize.DOUBLE
      },
      longitud: {
        type: Sequelize.DOUBLE
      },
      status: {
        type: Sequelize.STRING
      },
      fecha_aceptacion: {
        type: Sequelize.DATE
      },
      id_curador: {
        type: Sequelize.TEXT
      },
      comentario_curador: {
        type: Sequelize.TEXT
      },
      en_pausa: {
        type: Sequelize.BOOLEAN
      },
      comentario_usuario: {
        type: Sequelize.TEXT
      },
      file_type: {
        type: Sequelize.STRING
      },
      tiene_ficha: {
        type: Sequelize.BOOLEAN
      },
      geom: {
        type: Sequelize.GEOMETRY
      },
      es_notificado: {
        type: Sequelize.BOOLEAN
      },
      id_proyecto: {
        type: Sequelize.BIGINT
      },
      respuestas_ficha: {
        type: Sequelize.TEXT
      },
      datos_usuario: {
        type: Sequelize.TEXT
      },
      estado: {
        type: Sequelize.STRING
      },
      municipio: {
        type: Sequelize.STRING
      },
      localidad: {
        type: Sequelize.STRING
      },
      media_array: {
        type: Sequelize.TEXT
      },
      ubicacion_sensible: {
        type: Sequelize.BOOLEAN
      },
      curador_notificado: {
        type: Sequelize.BOOLEAN
      },
      isfromgallery: {
        type: Sequelize.BOOLEAN
      },
      insitu: {
        type: Sequelize.BOOLEAN
      },
      ocultar_ficha: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      entidad_cvegeo: {
        type: Sequelize.STRING(200)
      },
      entidad_nombre: {
        type: Sequelize.STRING(200)
      },
      institucion_nombre: {
        type: Sequelize.STRING(200)
      }
    });

    // Table: levantamientos_mensajes
    await queryInterface.createTable('levantamientos_mensajes', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      levantamiento_id: {
        type: Sequelize.BIGINT
      },
      fecha_hora: {
        type: Sequelize.DATE
      },
      texto: {
        type: Sequelize.TEXT
      },
      tipo_usuario: {
        type: Sequelize.STRING
      },
      usuario_id: {
        type: Sequelize.TEXT
      }
    });

    // Table: login_activity
    await queryInterface.createTable('login_activity', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      initial_date: {
        type: Sequelize.DATE
      },
      final_date: {
        type: Sequelize.DATE
      },
      update_date: {
        type: Sequelize.DATE
      },
      monitor_id: {
        type: Sequelize.BIGINT
      }
    });

    // Table: polygon
    await queryInterface.createTable('polygon', {
      id_polygon: {
        type: Sequelize.DECIMAL,
        primaryKey: true,
        allowNull: false
      },
      geojson: {
        type: Sequelize.TEXT
      }
    });

    // Table: proyectos
    await queryInterface.createTable('proyectos', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      nombre: {
        type: Sequelize.STRING,
        allowNull: false
      },
      categoria: {
        type: Sequelize.TEXT
      },
      institucion: {
        type: Sequelize.STRING
      },
      imagen: {
        type: Sequelize.STRING
      },
      activo: {
        type: Sequelize.BOOLEAN
      },
      fecha_creacion: {
        type: Sequelize.DATE
      },
      fecha_desactivacion: {
        type: Sequelize.DATE
      },
      region: {
        type: Sequelize.GEOMETRY
      },
      id_propietario: {
        type: Sequelize.TEXT
      },
      id_desactivado_por: {
        type: Sequelize.TEXT
      },
      geometria: {
        type: Sequelize.JSON
      },
      ficha_proyecto: {
        type: Sequelize.TEXT
      },
      lider: {
        type: Sequelize.STRING
      },
      objetivo: {
        type: Sequelize.TEXT
      },
      instrucciones: {
        type: Sequelize.STRING
      },
      producto: {
        type: Sequelize.TEXT
      },
      id_curador: {
        type: Sequelize.TEXT
      },
      status: {
        type: Sequelize.STRING
      },
      fecha_aceptacion: {
        type: Sequelize.DATE
      },
      comentario_curador: {
        type: Sequelize.STRING
      },
      comentario_usuario: {
        type: Sequelize.STRING
      },
      en_pausa: {
        type: Sequelize.BOOLEAN
      },
      es_notificado: {
        type: Sequelize.BOOLEAN
      },
      curador_notificado: {
        type: Sequelize.BOOLEAN
      },
      es_destacado: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      es_institucion: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      es_privada: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
      },
      lista_municipios: {
        type: Sequelize.JSON
      }
    });

    // Table: proyectos_destacados
    await queryInterface.createTable('proyectos_destacados', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      usuario_id: {
        type: Sequelize.TEXT,
        allowNull: false
      },
      proyecto_id: {
        type: Sequelize.INTEGER,
        allowNull: false
      }
    });

    // Table: proyectos_mensajes
    await queryInterface.createTable('proyectos_mensajes', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      proyecto_id: {
        type: Sequelize.INTEGER
      },
      fecha_hora: {
        type: Sequelize.DATE
      },
      texto: {
        type: Sequelize.TEXT
      },
      tipo_usuario: {
        type: Sequelize.STRING
      },
      usuario_id: {
        type: Sequelize.TEXT
      }
    });

    // Table: proyectos_usuarios
    await queryInterface.createTable('proyectos_usuarios', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      proyecto_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: 'proyectos',
          key: 'id'
        },
        onDelete: 'CASCADE'
      },
      correo: {
        type: Sequelize.STRING(255),
        allowNull: false
      },
      rol: {
        type: Sequelize.STRING,
        allowNull: false
      },
      created_date: {
        type: Sequelize.DATE
      },
      update_date: {
        type: Sequelize.DATE
      },
      es_notificado: {
        type: Sequelize.BOOLEAN
      },
      texto: {
        type: Sequelize.TEXT
      },
    });

    // Table: user_categories
    await queryInterface.createTable('user_categories', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      category: {
        type: Sequelize.STRING(255),
        allowNull: false
      }
    });

    
    // Table: version
    await queryInterface.createTable('version', {
      current_app_version: {
        type: Sequelize.STRING
      }
    });

    // Table: version_app
    await queryInterface.createTable('version_app', {
      id: {
        type: Sequelize.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false
      },
      platform: {
        type: Sequelize.STRING
      },
      version: {
        type: Sequelize.STRING
      }
    });
  },

  async down(queryInterface, Sequelize) {
    // Drop tables in reverse order of creation or dependency
    await queryInterface.dropTable('version_app');
    await queryInterface.dropTable('version');
    await queryInterface.dropTable('users_info');
    await queryInterface.dropTable('users');
    await queryInterface.dropTable('user_categories');
    await queryInterface.dropTable('proyectos_usuarios');
    await queryInterface.dropTable('proyectos_mensajes');
    await queryInterface.dropTable('proyectos_destacados');
    await queryInterface.dropTable('proyectos');
    await queryInterface.dropTable('polygon');
    await queryInterface.dropTable('places');
    await queryInterface.dropTable('login_activity');
    await queryInterface.dropTable('levantamientos_mensajes');
    await queryInterface.dropTable('levantamientos');
    await queryInterface.dropTable('guest_user');
    await queryInterface.dropTable('fichas_templates');
    await queryInterface.dropTable('ficha_template');
    await queryInterface.dropTable('ficha_respuestas');
    await queryInterface.dropTable('ficha_preguntas');
    await queryInterface.dropTable('dim_municipio');
    await queryInterface.dropTable('dim_localidad_urbana');
    await queryInterface.dropTable('dim_entidad');
    await queryInterface.dropTable('devices');
    await queryInterface.dropTable('descargas');
    await queryInterface.dropTable('configuracion');
    await queryInterface.dropTable('categories_places');
    await queryInterface.dropTable('binnacle');
    await queryInterface.dropTable('areas');
  }
};
