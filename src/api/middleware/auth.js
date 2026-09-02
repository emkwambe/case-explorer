export function apiKeyAuth(req, res, next) {
  const key = req.headers['x-api-key'];
  const allowedKeys = (process.env.API_KEYS || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  if (allowedKeys.length === 0) {
    console.warn('API_KEYS environment variable is not configured. Requests will be rejected.');
  }

  if (!key || !allowedKeys.includes(key)) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing X-API-Key header' });
  }

  next();
}
