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

module.exports = { sendTextMessage };
