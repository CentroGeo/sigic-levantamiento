const express = require('express');
const router = express.Router();

const projectsController = require('../controllers/projects.controller');
const Authenticator = require("../helpers/Authenticator");
const Filer = require('../helpers/Filer');

const auth = new Authenticator();
const filer = new Filer("proyectos", "imagen");


router.get('/public', projectsController.publicProjects);
router.post('/own', projectsController.ownprojects);
router.post('/shared', projectsController.sharedProjects);
router.post('/create', filer.sigleUpload("image"), projectsController.createProject);
router.put('/update/:id', filer.sigleUpload("image"), projectsController.updateProject);
router.put('/deactivate/:id', projectsController.deactivateProject);

router.post('/shared/:project/user/list', projectsController.sharedProjectsUserList);
router.post('/shared/:project/user/add', projectsController.sharedProjectsUserAdd);
router.delete('/shared/:project/user/:user_id/remove', projectsController.sharedProjectsUserRemove);
router.post('/shared/:project/user/:user_id/update', projectsController.sharedProjectsUserUpdate);

router.post('/raising/:project/list', projectsController.raisingProjectsUserList);

module.exports = router;
