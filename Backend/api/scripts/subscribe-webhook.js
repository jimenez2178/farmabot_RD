require('dotenv').config();

const GRAPH_API_VERSION = process.env.WHATSAPP_API_VERSION || 'v21.0';

// Suscribe la app (configurada en developers.facebook.com) a los eventos de esta
// WhatsApp Business Account. Los campos que llegan (p.ej. "messages") dependen de
// los que estén marcados en Meta App Dashboard > WhatsApp > Configuración > Webhooks.
async function subscribeWebhook() {
  const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!wabaId || !token) {
    throw new Error('Faltan WHATSAPP_BUSINESS_ACCOUNT_ID o WHATSAPP_ACCESS_TOKEN en .env');
  }

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${wabaId}/subscribed_apps`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error('La suscripción falló, revisa el mensaje de error de arriba.');
  }

  console.log('Webhook suscrito correctamente a la WhatsApp Business Account', wabaId);
}

subscribeWebhook().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
