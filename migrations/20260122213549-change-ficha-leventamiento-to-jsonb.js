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
      ALTER TABLE levantamientos
      ALTER COLUMN respuestas_ficha
      TYPE jsonb
      USING respuestas_ficha::jsonb
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
      ALTER TABLE levantamientos
      ALTER COLUMN respuestas_ficha
      TYPE text[]
      USING ARRAY(
        SELECT jsonb_array_elements_text(respuestas_ficha)
      )
    `);
  }
};
