'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE proyectos
      ALTER COLUMN ficha_proyecto
      TYPE jsonb
      USING ficha_proyecto::jsonb
    `);
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
    await queryInterface.sequelize.query(`
      ALTER TABLE proyectos
      ALTER COLUMN ficha_proyecto
      TYPE text[]
      USING ARRAY(
        SELECT jsonb_array_elements_text(ficha_proyecto)
      )
    `);
  }
};
