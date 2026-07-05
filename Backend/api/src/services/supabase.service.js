const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

// Node 18 no trae WebSocket nativo (llegó en Node 22). El cliente de Supabase
// intenta detectarlo al crearse aunque este bot no use canales realtime, así
// que le indicamos explícitamente que use el paquete "ws" como transporte.
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  realtime: {
    transport: WebSocket,
  },
});

async function findFarmaciaByPhoneNumberId(phoneNumberId) {
  const { data, error } = await supabase
    .from('farmacias')
    .select('*')
    .eq('whatsapp_phone_id', phoneNumberId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function findOrCreateCliente(farmaciaId, telefonoWhatsapp) {
  const { data: existing, error: selectError } = await supabase
    .from('clientes')
    .select('*')
    .eq('farmacia_id', farmaciaId)
    .eq('telefono_whatsapp', telefonoWhatsapp)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('clientes')
    .insert({ farmacia_id: farmaciaId, telefono_whatsapp: telefonoWhatsapp })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

async function findOrCreateConversacionActiva(farmaciaId, clienteId) {
  const { data: existing, error: selectError } = await supabase
    .from('conversaciones')
    .select('*')
    .eq('farmacia_id', farmaciaId)
    .eq('cliente_id', clienteId)
    .eq('estado', 'activa')
    .order('fecha_inicio', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) throw selectError;
  if (existing) return existing;

  const { data: created, error: insertError } = await supabase
    .from('conversaciones')
    .insert({ farmacia_id: farmaciaId, cliente_id: clienteId })
    .select()
    .single();

  if (insertError) throw insertError;
  return created;
}

async function guardarMensaje({ conversacionId, farmaciaId, origen, contenido, whatsappMessageId }) {
  const { data, error } = await supabase
    .from('mensajes')
    .insert({
      conversacion_id: conversacionId,
      farmacia_id: farmaciaId,
      origen,
      contenido,
      whatsapp_message_id: whatsappMessageId,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function obtenerHistorialConversacion(conversationId) {
  const { data, error } = await supabase
    .from('mensajes')
    .select('origen, contenido')
    .eq('conversacion_id', conversationId)
    .order('fecha_envio', { ascending: false })
    .limit(10); // Últimos 10 mensajes para no saturar el contexto de Claude

  if (error) throw error;
  return (data || []).reverse();
}

async function guardarPedido({
  farmaciaId,
  clienteId,
  conversacionId,
  medicamento,
  cantidad,
  tipoEntrega,
  direccion,
  telefonoContacto,
  horaEntrega,
  formaPago,
  comprobanteFiscal,
  sucursalId,
  estado,
  totalEstimado,
}) {
  const { data, error } = await supabase
    .from('pedidos')
    .insert([{
      farmacia_id: farmaciaId,
      cliente_id: clienteId,
      conversacion_id: conversacionId,
      estado: estado || 'pendiente',
      // La tabla solo acepta 'recoger' o 'delivery'; Claude puede responder "retiro".
      tipo_entrega: tipoEntrega === 'retiro' ? 'recoger' : tipoEntrega,
      direccion_entrega: direccion,
      telefono_contacto: telefonoContacto,
      hora_entrega: horaEntrega,
      forma_pago: formaPago,
      comprobante_fiscal: !!comprobanteFiscal,
      sucursal_id: sucursalId,
      notas: `${medicamento} x${cantidad}`,
      total_estimado: totalEstimado,
    }])
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function obtenerSucursalesActivas(farmaciaId) {
  const { data, error } = await supabase
    .from('sucursales')
    .select('id, nombre')
    .eq('farmacia_id', farmaciaId)
    .eq('activa', true);

  if (error) throw error;
  return data || [];
}

async function obtenerMedicamentosFarmacia(farmaciaId) {
  const { data, error } = await supabase
    .from('medicamentos')
    .select('nombre, nombre_alternativo, categoria, precio')
    .eq('farmacia_id', farmaciaId)
    .eq('disponible', true);

  if (error) throw error;
  return data || [];
}

module.exports = {
  supabase,
  findFarmaciaByPhoneNumberId,
  findOrCreateCliente,
  findOrCreateConversacionActiva,
  guardarMensaje,
  obtenerHistorialConversacion,
  guardarPedido,
  obtenerMedicamentosFarmacia,
  obtenerSucursalesActivas,
};
