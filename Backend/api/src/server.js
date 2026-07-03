require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const webhookRoutes = require('./routes/webhook.routes');
const recordatoriosRoutes = require('./routes/recordatorios.routes');
const { procesarRecordatoriosDeHoy } = require('./controllers/recordatorios.controller');

const app = express();
app.use(express.json());

app.use('/webhook', webhookRoutes);
app.use('/api/recordatorios', recordatoriosRoutes);

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`FarmaBot-RD API escuchando en el puerto ${PORT}`);
});

// Recordatorios de recompra: todos los días a las 8:00am hora de RD.
cron.schedule('0 8 * * *', async () => {
  console.log('[cron] Iniciando envío de recordatorios de recompra...');
  try {
    const resumen = await procesarRecordatoriosDeHoy();
    console.log(`[cron] Terminado: ${resumen.enviados} enviados, ${resumen.fallidos} fallidos, de ${resumen.total} encontrados.`);
  } catch (err) {
    console.error('[cron] Error ejecutando recordatorios:', err);
  }
}, { timezone: 'America/Santo_Domingo' });

// Sin esto, nodemon reinicia el proceso node hijo pero el socket anterior
// queda huérfano escuchando el puerto y la siguiente ejecución falla con EADDRINUSE.
function shutdown() {
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
