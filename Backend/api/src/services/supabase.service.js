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

async function guardarMensaje({ conversacionId, farmaciaId, origen, contenido, whatsappMessageId, tipo }) {
  const { data, error } = await supabase
    .from('mensajes')
    .insert({
      conversacion_id: conversacionId,
      farmacia_id: farmaciaId,
      origen,
      contenido,
      whatsapp_message_id: whatsappMessageId,
      tipo: tipo || 'texto',
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
    .limit(30); // Últimos 30 mensajes: el pedido normal + el flujo de seguro médico (fotos incluidas)

  if (error) throw error;
  return (data || []).reverse();
}

async function guardarPedido({
  farmaciaId,
  clienteId,
  conversacionId,
  items,
  tipoEntrega,
  direccion,
  telefonoContacto,
  formaPago,
  comprobanteFiscal,
  sucursalId,
  estado,
  totalEstimado,
  tipoCobertura,
  nombreSeguro,
  fotoCarnetUrl,
  fotoCedulaUrl,
}) {
  const notas = items.map((item) => `${item.nombreMedicamento} x${item.cantidad}`).join(', ');

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
      forma_pago: formaPago,
      comprobante_fiscal: !!comprobanteFiscal,
      sucursal_id: sucursalId,
      notas,
      total_estimado: totalEstimado,
      tipo_cobertura: tipoCobertura,
      nombre_seguro: nombreSeguro,
      foto_carnet_url: fotoCarnetUrl,
      foto_cedula_url: fotoCedulaUrl,
    }])
    .select()
    .single();

  if (error) throw error;

  const { error: itemsError } = await supabase
    .from('items_pedido')
    .insert(items.map((item) => ({
      pedido_id: data.id,
      medicamento_id: item.medicamentoId,
      nombre_medicamento: item.nombreMedicamento,
      precio_unitario: item.precioUnitario,
      cantidad: item.cantidad,
      subtotal: item.subtotal,
    })));

  if (itemsError) throw itemsError;

  return data;
}

// Guarda solo la RUTA del archivo en el bucket (privado), no una URL firmada:
// las firmadas expiran, así que se generan al vuelo cuando alguien necesite ver la foto.
async function subirDocumentoPedido({ farmaciaId, telefono, tipoDocumento, buffer, mimeType }) {
  const extension = (mimeType || '').split('/')[1]?.split(';')[0] || 'jpg';
  const path = `${farmaciaId}/${telefono}_${Date.now()}_${tipoDocumento}.${extension}`;

  const { error } = await supabase.storage
    .from('documentos-pedidos')
    .upload(path, buffer, { contentType: mimeType });

  if (error) throw error;
  return path;
}

async function actualizarContextoPedido(conversacionId, contextoPedido) {
  const { error } = await supabase
    .from('conversaciones')
    .update({ contexto_pedido: contextoPedido })
    .eq('id', conversacionId);

  if (error) throw error;
}

// Se cierra al confirmar un pedido para que el siguiente mensaje de este cliente
// arranque una conversación NUEVA (historial vacío, contexto_pedido en '{}'), en vez
// de seguir acumulando mensajes y estado de pedidos ya resueltos indefinidamente.
async function cerrarConversacion(conversacionId) {
  const { error } = await supabase
    .from('conversaciones')
    .update({ estado: 'cerrada' })
    .eq('id', conversacionId);

  if (error) throw error;
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
    .select('id, nombre, nombre_alternativo, categoria, precio')
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
  subirDocumentoPedido,
  actualizarContextoPedido,
  cerrarConversacion,
};
