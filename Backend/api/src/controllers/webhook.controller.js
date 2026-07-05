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
  const message = extractIncomingTextMessage(value);
  if (!message) return;

  const phoneNumberId = value?.metadata?.phone_number_id;

  handleIncomingMessage(message, phoneNumberId).catch((err) => {
    console.error('Error procesando mensaje entrante:', err);
  });
}

function extractIncomingTextMessage(value) {
  const message = value?.messages?.[0];

  if (!message || message.type !== 'text') return null;

  return { from: message.from, text: message.text.body, whatsappMessageId: message.id };
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

  // LLAMAR a getReply con el historial que NO incluye el mensaje actual
  let { texto, pedido } = await claudeService.getReply(
    message.text,
    farmacia.nombre,
    conversacion.id,
    historialConversacion,
    medicamentos,
    sucursalesActivas,
  );
  console.log('Respuesta de Claude:', texto);

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
        clienteId: cliente.id,
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
      });
    }
  }

  await supabaseService.guardarMensaje({
    conversacionId: conversacion.id,
    farmaciaId: farmacia.id,
    origen: 'bot',
    contenido: texto,
  });

  await whatsappService.sendTextMessage(message.from, texto);
}

module.exports = { verifyWebhook, receiveWebhook };
