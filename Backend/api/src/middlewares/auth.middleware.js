// Protege endpoints internos (disparados manualmente o por el propio backend, no por Meta)
// con una API key compartida, guardada en INTERNAL_API_KEY.
function auth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey || apiKey !== process.env.INTERNAL_API_KEY) {
    return res.sendStatus(401);
  }

  next();
}

module.exports = { auth };
