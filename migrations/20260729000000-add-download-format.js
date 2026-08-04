'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('descargas', 'formato', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'xlsx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('descargas', 'formato');
  },
};
