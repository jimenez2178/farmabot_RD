const { Router } = require('express');
const { verifyWebhook, receiveWebhook } = require('../controllers/webhook.controller');

const router = Router();

router.get('/', verifyWebhook);
router.post('/', receiveWebhook);

module.exports = router;
