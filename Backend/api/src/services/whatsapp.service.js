const GRAPH_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

async function sendTextMessage(to, body) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error al enviar mensaje de WhatsApp: ${JSON.stringify(data)}`);
  }

  return data;
}

// Meta solo manda el ID del media en el webhook. Hay que pedirle a la Graph API
// la URL real (que expira rápido), y descargarla de inmediato con el mismo token.
async function obtenerUrlMedia(mediaId) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${mediaId}`;

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(`Error al obtener URL de media de WhatsApp: ${JSON.stringify(data)}`);
  }

  return { url: data.url, mimeType: data.mime_type };
}

async function descargarMedia(mediaId) {
  const { url, mimeType } = await obtenerUrlMedia(mediaId);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
  });

  if (!response.ok) {
    throw new Error(`Error al descargar media de WhatsApp: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, mimeType };
}

module.exports = { sendTextMessage, descargarMedia };
