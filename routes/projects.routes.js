const express = require('express');
const router = express.Router();

const projectsController = require('../controllers/projects.controller');
const Authenticator = require("../helpers/Authenticator");
const Filer = require('../helpers/Filer');

const auth = new Authenticator();
const filer = new Filer("proyectos", "imagen");

//Apis para las vista de usuario 
router.get('/public', projectsController.publicProjects);
router.post('/own', projectsController.ownprojects);
router.post('/shared', projectsController.sharedProjects);

//Apis para creación, edición y desactivación de proyectos
router.post('/create', filer.sigleUpload("image"), projectsController.createProject);
router.put('/update/:id', filer.sigleUpload("image"), projectsController.updateProject);
router.put('/deactivate/:id', projectsController.deactivateProject);
router.post('/register/:id', projectsController.getRegisterProject);

//Apis para compartir proyectos con otros usuarios
router.post('/shared/:project/user/list', projectsController.sharedProjectsUserList);
router.post('/shared/:project/user/add', projectsController.sharedProjectsUserAdd);
router.delete('/shared/:project/user/:user_id/remove', projectsController.sharedProjectsUserRemove);
router.post('/shared/:project/user/:user_id/update', projectsController.sharedProjectsUserUpdate);

//Apis para las vistas de revisores
router.post('/reviewer/list', projectsController.reviewerProjects);

//Api para cambiar status de los proyectos
router.post('/reviewer/status/:id', projectsController.reviewerProjectsStatus);

//Api para eliminar sin no se utiliza
router.post('/raising/:project/list', projectsController.raisingProjectsUserList);

module.exports = router;
