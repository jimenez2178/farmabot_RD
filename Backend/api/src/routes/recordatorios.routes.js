const { Router } = require('express');
const { enviarRecordatoriosDeHoy } = require('../controllers/recordatorios.controller');
const { auth } = require('../middlewares/auth.middleware');

const router = Router();

router.post('/enviar-ahora', auth, enviarRecordatoriosDeHoy);

module.exports = router;
