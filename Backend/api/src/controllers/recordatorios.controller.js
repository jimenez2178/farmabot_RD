const recordatoriosService = require('../services/recordatorios.service');

async function procesarRecordatoriosDeHoy() {
  const recordatorios = await recordatoriosService.buscarRecordatoriosDeHoy();
  const detalle = [];

  for (const recordatorio of recordatorios) {
    try {
      await recordatoriosService.enviarWhatsAppRecordatorio(recordatorio);
      await recordatoriosService.marcarRecordatorioEnviado(recordatorio.id);
      await recordatoriosService.crearProximoRecordatorio(recordatorio);
      detalle.push({ recordatorio_id: recordatorio.id, cliente_id: recordatorio.cliente_id, estado: 'enviado' });
    } catch (err) {
      await recordatoriosService.manejarFalloEnvio(recordatorio, err);
      detalle.push({ recordatorio_id: recordatorio.id, cliente_id: recordatorio.cliente_id, estado: 'fallido', error: err.message });
    }
  }

  const enviados = detalle.filter((d) => d.estado === 'enviado').length;
  const fallidos = detalle.filter((d) => d.estado === 'fallido').length;

  return { total: recordatorios.length, enviados, fallidos, detalle };
}

async function enviarRecordatoriosDeHoy(req, res) {
  try {
    const resumen = await procesarRecordatoriosDeHoy();
    res.json(resumen);
  } catch (err) {
    console.error('Error procesando recordatorios:', err);
    res.status(500).json({ error: 'Error procesando recordatorios' });
  }
}

module.exports = { enviarRecordatoriosDeHoy, procesarRecordatoriosDeHoy };
