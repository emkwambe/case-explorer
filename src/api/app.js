import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { apiKeyAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.js';
import configRoutes from './routes/config.js';
import casesRoutes from './routes/cases.js';
import batchRoutes from './routes/batch.js';

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
  app.use(express.json());

  app.use('/api/health', healthRoutes);

  // Protected routes
  app.use(apiKeyAuth);
  app.use(rateLimit);
  app.use('/api/config', configRoutes);
  app.use('/api/cases', casesRoutes);
  app.use('/api/batch', batchRoutes);

  // 404 handler
  app.use((_req, _res, next) => {
    const err = new Error('Not found');
    err.status = 404;
    next(err);
  });

  app.use(errorHandler);

  return app;
}
