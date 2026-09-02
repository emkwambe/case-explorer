const store = new Map();

function getWindowConfig() {
  return {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60_000,
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100
  };
}

function cleanup(key, windowMs) {
  const now = Date.now();
  const timestamps = store.get(key);
  if (!timestamps) return;
  const valid = timestamps.filter(t => now - t < windowMs);
  if (valid.length === 0) store.delete(key);
  else store.set(key, valid);
}

export function rateLimit(req, res, next) {
  const key = req.headers['x-api-key'] || 'anonymous';
  const { windowMs, maxRequests } = getWindowConfig();
  const now = Date.now();

  cleanup(key, windowMs);
  const timestamps = store.get(key) || [];

  if (timestamps.length >= maxRequests) {
    const oldest = timestamps[0];
    const resetAt = oldest + windowMs;
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', 0);
    res.setHeader('X-RateLimit-Reset', new Date(resetAt).toISOString());
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  timestamps.push(now);
  store.set(key, timestamps);

  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - timestamps.length));
  res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

  next();
}
