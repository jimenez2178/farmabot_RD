# FarmaBot-RD — Asistente de WhatsApp con IA para Farmacias

## Qué es
Un agente de WhatsApp con inteligencia artificial, pensado para venderse como servicio mensual a farmacias independientes en Santo Domingo, República Dominicana. Es **multi-tenant desde el día 1**: un solo sistema sirve a varias farmacias, cada una con sus datos completamente separados.

## Problema que resuelve
Las farmacias reciben muchos mensajes de WhatsApp preguntando disponibilidad y precio de medicamentos, y no tienen forma de contestar fuera de horario o cuando el mostrador está lleno. Además, no le dan seguimiento a clientes de tratamiento largo (presión, diabetes, colesterol) que dejan de comprar simplemente porque nadie les recuerda.

## Funciones del MVP (lo que se construye primero)
1. **Chatbot de pedidos y consultas por WhatsApp**: responde disponibilidad, precio, y toma pedidos (recoger o delivery), las 24 horas.
2. **Recordatorio automático de recompra**: al día 25 de una compra de un tratamiento de 30 días, el bot le escribe solo al cliente preguntando si necesita reabastecerse. Es la pieza con mejor retorno de inversión demostrable.
3. **Escalamiento a humano**: si el bot no sabe contestar o es una pregunta de salud, la conversación se pasa a un empleado designado de la farmacia (no al dueño directamente).
4. **Reporte simple**: resumen semanal de pedidos, recordatorios enviados y conversiones — se manda por email o WhatsApp. **No hay panel web todavía** (se construye más adelante, cuando haya suficientes farmacias para justificarlo).

## Lo que NO se construye todavía (para no perder tiempo antes de necesitarlo)
- Panel/dashboard para que el dueño de la farmacia vea sus datos
- Registro automático (self-service) de farmacias nuevas — al inicio, Jesús carga los datos manualmente
- Cálculo automático de facturación — al inicio, Jesús factura manualmente según volumen de mensajes

## Decisiones técnicas ya tomadas
- **Conexión a WhatsApp:** API oficial de Meta (WhatsApp Cloud API) — no la opción no oficial, para evitar el riesgo de que le baneen el número a un cliente.
- **Motor de automatización:** n8n, autoalojado en un VPS propio en Hostinger.
- **IA:** Claude (empezando con el modelo Haiku, por ser el más económico y suficiente para este tipo de conversación).
- **Base de datos:** por definir en la fase siguiente (probablemente Supabase, herramienta habitual de Jesús).
- **Modelo de cobro a las farmacias:** por volumen de mensajes, con un piso fijo mensual más cargo por excedente. Jesús factura manualmente al inicio.

## Sobre el negocio
- Va dirigido a farmacias independientes (no cadenas grandes) en Santo Domingo.
- Oferta piloto de 30 días (gratis o precio simbólico) antes de pasar a plan mensual regular (RD$1,500–RD$3,500 según volumen).
- El pitch de venta y manejo de objeciones ya están definidos (ver guion de venta separado).

## Sobre quién construye esto
Jesús Manuel Jiménez, periodista y "vibe coder" (no programador de formación), bajo su marca EduNexus Plus. El código se implementa con Claude Code; las decisiones de arquitectura y planificación se hacen con Claude (este documento es resultado de esa planificación).

## Estado actual (2026-07-02)
- **Backend (`Backend/api`) funcionando en local**: servidor Express arranca con `npm run dev`, escucha en el puerto 3000.
- **Webhook verificado**: `POST /webhook` responde `200 OK` de inmediato y procesa el mensaje de forma asíncrona, tal como exige la Cloud API de Meta.
- **Claude Haiku respondiendo correctamente**: probado con un mensaje de prueba ("¿tienen Losartán 50mg?"), el modelo contesta de forma coherente y en el tono definido en el system prompt. La respuesta ahora se imprime en consola (`console.log` en `webhook.controller.js`) para debug.
- **Pendiente: token permanente de WhatsApp.** El envío de la respuesta a la Cloud API de Meta falla con `OAuthException` (código 190, "Authentication Error") — el `WHATSAPP_ACCESS_TOKEN` en `.env` está vencido o no es válido. Hay que generar un token de acceso permanente (system user token) desde Meta for Developers y actualizarlo en `.env`; los tokens temporales expiran cada 24h y no sirven para producción.