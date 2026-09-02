export function errorHandler(err, _req, res, _next) {
  const isDev = process.env.NODE_ENV === 'development';
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  const payload = { error: message };
  if (isDev && err.stack) {
    payload.stack = err.stack;
  }

  res.status(status).json(payload);
}
