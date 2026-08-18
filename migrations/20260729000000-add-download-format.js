'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  /**
   * Registra el formato solicitado para que la generación, revisión y descarga
   * entreguen el tipo de archivo correcto. XLSX conserva compatibilidad con
   * las solicitudes creadas antes de esta migración.
   */
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('descargas', 'formato', {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: 'xlsx',
    });
  },

  /** Revierte el metadato de formato sin alterar los demás datos de la solicitud. */
  async down(queryInterface) {
    await queryInterface.removeColumn('descargas', 'formato');
  },
};
