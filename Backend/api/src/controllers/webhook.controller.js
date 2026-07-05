const claudeService = require('../services/claude.service');
const whatsappService = require('../services/whatsapp.service');
const supabaseService = require('../services/supabase.service');

// Meta llama a este endpoint con GET una sola vez, al configurar el webhook,
// para confirmar que el servidor es dueño de la URL.
function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
}

// Meta llama a este endpoint con POST cada vez que llega un mensaje o evento.
// Se responde 200 de inmediato porque Meta reintenta el envío si no recibe
// respuesta rápido, y el resto (llamar a Claude, contestar por WhatsApp) se
// procesa después, sin bloquear esa respuesta.
function receiveWebhook(req, res) {
  res.sendStatus(200);

  const value = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = extractIncomingMessage(value);
  if (!message) return;

  const phoneNumberId = value?.metadata?.phone_number_id;
  const handler = message.type === 'image' ? handleIncomingImageMessage : handleIncomingMessage;

  handler(message, phoneNumberId).catch((err) => {
    console.error('Error procesando mensaje entrante:', err);
  });
}

function extractIncomingMessage(value) {
  const message = value?.messages?.[0];
  if (!message) return null;

  if (message.type === 'text') {
    return { type: 'text', from: message.from, text: message.text.body, whatsappMessageId: message.id };
  }

  if (message.type === 'image') {
    return { type: 'image', from: message.from, mediaId: message.image?.id, whatsappMessageId: message.id };
  }

  return null;
}

// Claude solo menciona el total en el mensaje de texto al cliente, no lo incluye
// en el JSON del pedido. Lo recalculamos aquí a partir del catálogo (misma fuente
// de precios que usa Claude) para no depender de que la IA haga bien la aritmética.
function calcularTotalEstimado(nombreMedicamento, cantidad, medicamentos) {
  if (!nombreMedicamento || !cantidad) return null;

  const texto = nombreMedicamento.toLowerCase();
  const match = medicamentos.find((m) => {
    const nombre = m.nombre?.toLowerCase();
    const alterno = m.nombre_alternativo?.toLowerCase();
    return (nombre && (texto.includes(nombre) || nombre.includes(texto)))
      || (alterno && (texto.includes(alterno) || alterno.includes(texto)));
  });

  if (!match) return null;
  return Number(match.precio) * Number(cantidad);
}

async function handleIncomingMessage(message, phoneNumberId) {
  const farmacia = await supabaseService.findFarmaciaByPhoneNumberId(phoneNumberId);
  if (!farmacia) {
    console.error(`Farmacia no encontrada para whatsapp_phone_id: ${phoneNumberId}`);
    return;
  }

  const cliente = await supabaseService.findOrCreateCliente(farmacia.id, message.from);
  const conversacion = await supabaseService.findOrCreateConversacionActiva(farmacia.id, cliente.id);
  const medicamentos = await supabaseService.obtenerMedicamentosFarmacia(farmacia.id);
  const sucursalesActivas = await supabaseService.obtenerSucursalesActivas(farmacia.id);

  // TRAER el historial ANTES de guardar el mensaje
  const historialConversacion = await supabaseService.obtenerHistorialConversacion(conversacion.id);

  // GUARDAR el mensaje del cliente
  await supabaseService.guardarMensaje({
    conversacionId: conversacion.id,
    farmaciaId: farmacia.id,
    origen: 'cliente',
    contenido: message.text,
    whatsappMessageId: message.whatsappMessageId,
  });

  await continuarFlujoClaude({
    farmacia,
    conversacion,
    medicamentos,
    sucursalesActivas,
    userMessageText: message.text,
    historialConversacion,
    to: message.from,
  });
}

// Meta solo manda el ID de la imagen en el webhook; hay que descargarla y, según el
// "paso" en el que esté la conversación (guardado en conversaciones.contexto_pedido),
// decidir si es la foto del carnet de seguro o la de la cédula. Claude nunca ve
// imágenes, así que esta decisión es 100% determinística, no pasa por la IA.
async function handleIncomingImageMessage(message, phoneNumberId) {
  const farmacia = await supabaseService.findFarmaciaByPhoneNumberId(phoneNumberId);
  if (!farmacia) {
    console.error(`Farmacia no encontrada para whatsapp_phone_id: ${phoneNumberId}`);
    return;
  }

  const cliente = await supabaseService.findOrCreateCliente(farmacia.id, message.from);
  const conversacion = await supabaseService.findOrCreateConversacionActiva(farmacia.id, cliente.id);

  const contextoPedido = conversacion.contexto_pedido || {};
  const esperandoFoto = contextoPedido.esperando_foto;

  if (esperandoFoto !== 'carnet' && esperandoFoto !== 'cedula') {
    await whatsappService.sendTextMessage(
      message.from,
      'Recibí tu imagen, pero en este momento no es necesaria. ¿Te ayudo con algo más?',
    );
    return;
  }

  const { buffer, mimeType } = await whatsappService.descargarMedia(message.mediaId);
  const path = await supabaseService.subirDocumentoPedido({
    farmaciaId: farmacia.id,
    telefono: message.from,
    tipoDocumento: esperandoFoto,
    buffer,
    mimeType,
  });

  if (esperandoFoto === 'carnet') {
    await supabaseService.actualizarContextoPedido(conversacion.id, {
      ...contextoPedido,
      esperando_foto: 'cedula',
      foto_carnet_url: path,
    });

    await supabaseService.guardarMensaje({
      conversacionId: conversacion.id,
      farmaciaId: farmacia.id,
      origen: 'cliente',
      contenido: '[Cliente adjuntó foto de su carnet de seguro médico]',
      whatsappMessageId: message.whatsappMessageId,
      tipo: 'imagen',
    });

    const texto = '¡Perfecto! Ahora envíame una foto de tu cédula, por favor.';
    await supabaseService.guardarMensaje({
      conversacionId: conversacion.id,
      farmaciaId: farmacia.id,
      origen: 'bot',
      contenido: texto,
    });
    await whatsappService.sendTextMessage(message.from, texto);
    return;
  }

  // esperandoFoto === 'cedula': ya tenemos ambos documentos, se retoma el flujo normal con Claude.
  const nuevoContexto = { ...contextoPedido, esperando_foto: null, foto_cedula_url: path };
  await supabaseService.actualizarContextoPedido(conversacion.id, nuevoContexto);

  const historialConversacion = await supabaseService.obtenerHistorialConversacion(conversacion.id);
  const markerTexto = '[Cliente adjuntó foto de su cédula. Documentos completos.]';

  await supabaseService.guardarMensaje({
    conversacionId: conversacion.id,
    farmaciaId: farmacia.id,
    origen: 'cliente',
    contenido: markerTexto,
    whatsappMessageId: message.whatsappMessageId,
    tipo: 'imagen',
  });

  const medicamentos = await supabaseService.obtenerMedicamentosFarmacia(farmacia.id);
  const sucursalesActivas = await supabaseService.obtenerSucursalesActivas(farmacia.id);

  await continuarFlujoClaude({
    farmacia,
    conversacion: { ...conversacion, contexto_pedido: nuevoContexto },
    medicamentos,
    sucursalesActivas,
    userMessageText: markerTexto,
    historialConversacion,
    to: message.from,
  });
}

// Llama a Claude, guarda el pedido si ya se confirmó (incluyendo datos de seguro y
// las fotos que se hayan recolectado hasta ahora), actualiza el "paso" de la
// conversación si Claude pidió una foto, y responde al cliente por WhatsApp.
async function continuarFlujoClaude({
  farmacia,
  conversacion,
  medicamentos,
  sucursalesActivas,
  userMessageText,
  historialConversacion,
  to,
}) {
  let { texto, pedido, solicitaFoto } = await claudeService.getReply(
    userMessageText,
    farmacia.nombre,
    conversacion.id,
    historialConversacion,
    medicamentos,
    sucursalesActivas,
  );
  console.log('Respuesta de Claude:', texto);

  const contextoPedido = conversacion.contexto_pedido || {};

  if (pedido) {
    if (sucursalesActivas.length === 0) {
      // No hay ninguna sucursal activa registrada: no se puede asociar el pedido.
      // No se guarda el pedido y se avisa al cliente en vez de confirmarlo.
      console.error(`Farmacia ${farmacia.id} no tiene sucursales activas registradas. Pedido no guardado.`);
      texto = 'Lo sentimos, en este momento tenemos un problema técnico para procesar tu pedido. Por favor contáctanos directamente para completarlo.';
    } else {
      const totalEstimado = calcularTotalEstimado(pedido.medicamento, pedido.cantidad, medicamentos);

      // Con 1 sola sucursal activa se asigna automáticamente. Con varias, se usa
      // la que el cliente eligió (Claude la anota por su nombre exacto en el JSON).
      const sucursalId = sucursalesActivas.length === 1
        ? sucursalesActivas[0].id
        : (sucursalesActivas.find(
          (s) => s.nombre.toLowerCase() === (pedido.sucursal || '').toLowerCase(),
        )?.id ?? null);

      await supabaseService.guardarPedido({
        farmaciaId: farmacia.id,
        clienteId: conversacion.cliente_id,
        conversacionId: conversacion.id,
        medicamento: pedido.medicamento,
        cantidad: pedido.cantidad,
        tipoEntrega: pedido.tipo_entrega,
        direccion: pedido.direccion,
        telefonoContacto: pedido.telefono_contacto,
        horaEntrega: pedido.hora_entrega,
        formaPago: pedido.forma_pago,
        comprobanteFiscal: pedido.comprobanteFiscal,
        sucursalId,
        estado: 'pendiente',
        totalEstimado,
        tipoCobertura: pedido.tipo_cobertura,
        nombreSeguro: pedido.nombre_seguro,
        fotoCarnetUrl: contextoPedido.foto_carnet_url || null,
        fotoCedulaUrl: contextoPedido.foto_cedula_url || null,
      });

      if (Object.keys(contextoPedido).length > 0) {
        await supabaseService.actualizarContextoPedido(conversacion.id, {});
      }
    }
  } else if (solicitaFoto) {
    await supabaseService.actualizarContextoPedido(conversacion.id, {
      ...contextoPedido,
      esperando_foto: solicitaFoto,
    });
  }

  await supabaseService.guardarMensaje({
    conversacionId: conversacion.id,
    farmaciaId: farmacia.id,
    origen: 'bot',
    contenido: texto,
  });

  await whatsappService.sendTextMessage(to, texto);
}

module.exports = { verifyWebhook, receiveWebhook };
