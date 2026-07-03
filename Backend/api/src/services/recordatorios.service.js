const { supabase } = require('./supabase.service');
const whatsappService = require('./whatsapp.service');

function hoyEnRD() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(new Date());
}

function sumarDias(fechaISO, dias) {
  const [y, m, d] = fechaISO.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + dias);
  return date.toISOString().slice(0, 10);
}

async function buscarRecordatoriosDeHoy() {
  const { data, error } = await supabase
    .from('recordatorios')
    .select('*')
    .eq('fecha_programada_envio', hoyEnRD())
    .eq('estado', 'pendiente');

  if (error) throw error;
  return data;
}

async function enviarWhatsAppRecordatorio(recordatorio) {
  const { data: cliente, error: clienteError } = await supabase
    .from('clientes')
    .select('nombre, telefono_whatsapp')
    .eq('id', recordatorio.cliente_id)
    .single();

  if (clienteError) throw clienteError;

  const { data: farmacia, error: farmaciaError } = await supabase
    .from('farmacias')
    .select('nombre')
    .eq('id', recordatorio.farmacia_id)
    .single();

  if (farmaciaError) throw farmaciaError;

  const saludo = cliente.nombre ? `Hola ${cliente.nombre} 👋` : 'Hola 👋';
  const mensaje = `${saludo}

${farmacia.nombre} aquí. Hace 30 días que compraste tu medicamento.

¿Necesitas reabastecerte? Responde aquí y nos encargamos 💊`;

  await whatsappService.sendTextMessage(cliente.telefono_whatsapp, mensaje);
}

async function marcarRecordatorioEnviado(recordatorioId) {
  const { error } = await supabase
    .from('recordatorios')
    .update({ estado: 'enviado', fecha_envio_real: new Date().toISOString() })
    .eq('id', recordatorioId);

  if (error) throw error;
}

async function crearProximoRecordatorio(recordatorio) {
  const hoy = hoyEnRD();

  const { error } = await supabase.from('recordatorios').insert({
    farmacia_id: recordatorio.farmacia_id,
    cliente_id: recordatorio.cliente_id,
    medicamento_id: recordatorio.medicamento_id,
    pedido_origen_id: recordatorio.pedido_origen_id,
    fecha_compra_original: hoy,
    fecha_programada_envio: sumarDias(hoy, 30),
    estado: 'pendiente',
  });

  if (error) throw error;
}

async function manejarFalloEnvio(recordatorio, error) {
  console.error(`Fallo al enviar recordatorio ${recordatorio.id} (cliente ${recordatorio.cliente_id}):`, error.message);

  const { error: updateError } = await supabase
    .from('recordatorios')
    .update({ resultado: `Error: ${error.message}` })
    .eq('id', recordatorio.id);

  if (updateError) {
    console.error(`No se pudo guardar el resultado del fallo para ${recordatorio.id}:`, updateError.message);
  }
}

module.exports = {
  buscarRecordatoriosDeHoy,
  enviarWhatsAppRecordatorio,
  marcarRecordatorioEnviado,
  crearProximoRecordatorio,
  manejarFalloEnvio,
};
