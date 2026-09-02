import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { apiKeyAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { errorHandler } from './middleware/errorHandler.js';
import healthRoutes from './routes/health.js';
import configRoutes from './routes/config.js';
import batchRoutes from './routes/batch.js';
import { datasetsController } from './controllers/datasetsController.js';
import { caseWorkflowController } from './controllers/caseWorkflowController.js';
import { modelsController } from './controllers/modelsController.js';
import { analyticsController } from './controllers/analyticsController.js';
import { MemoryStore } from '../db/index.js';
import { metrics } from '../observability/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
export const API_VERSION = '2.0.0';

/**
 * @param {object} opts { store } — pass a store (MemoryStore | PostgresStore). Defaults to an in-memory store.
 */
export function createApp({ store = new MemoryStore() } = {}) {
  const app = express();
  app.locals.store = store;

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: process.env.CORS_ORIGIN || true }));
  app.use(express.json({ limit: '2mb' }));

  app.use('/api/health', healthRoutes);
  app.get('/api/health/store', async (_req, res) => {
    try { const audit = await store.verifyAudit(); res.json({ store: store.kind, audit_chain: audit, api_version: API_VERSION }); }
    catch (e) { res.status(500).json({ store: store.kind, error: e.message }); }
  });

  app.get('/api/metrics', (req, res) => {
    if ((req.get('accept') || '').includes('application/json')) return res.json(metrics.snapshot());
    res.type('text/plain; version=0.0.4').send(metrics.prometheus());
  });

  // OpenAPI + interactive docs (public)
  const openapiPath = path.join(ROOT, 'docs', 'openapi.yaml');
  app.get('/api/openapi.yaml', (_req, res) => res.type('text/yaml').send(fs.readFileSync(openapiPath, 'utf8')));
  app.get('/api/docs', (_req, res) => res.type('html').send(swaggerHtml()));
  try {
    const require = createRequire(import.meta.url);
    app.use('/api/docs/assets', express.static(require('swagger-ui-dist').getAbsoluteFSPath()));
  } catch { /* swagger assets optional */ }

  // Protected routes. Scoped to /api so the static demo UI below stays publicly reachable;
  // /api/health, /api/metrics, /api/docs and /api/openapi.yaml are registered above this line.
  app.use('/api', apiKeyAuth);
  app.use('/api', rateLimit);
  app.use('/api/config', configRoutes);
  app.use('/api/batch', batchRoutes);

  const ds = datasetsController(store);
  const cw = caseWorkflowController(store);
  const md = modelsController(store);
  const an = analyticsController(store);

  app.post('/api/datasets/generate', ds.generate);
  app.get('/api/datasets', ds.list);
  app.get('/api/datasets/:id', ds.get);
  app.get('/api/datasets/:id/cases', ds.cases);
  app.get('/api/datasets/:id/network', ds.network);

  app.post('/api/cases/generate', cw.generate);
  app.get('/api/cases/:id', cw.get);
  app.post('/api/cases/:id/score', cw.score);
  app.post('/api/cases/:id/review', cw.review);
  app.get('/api/cases/:id/explanation', cw.explanation);
  app.get('/api/cases/:id/investigation', cw.investigation);
  app.get('/api/cases/:id/audit', cw.audit);

  app.get('/api/models', md.list);
  app.post('/api/models/train', md.train);
  app.get('/api/models/:id', md.get);
  app.post('/api/models/:id/evaluate', md.evaluate);
  app.get('/api/jobs/:id', md.job);
  app.get('/api/evaluations', md.listEvaluations);
  app.get('/api/evaluations/:id/report', md.report);

  app.get('/api/rules', an.rules);
  app.get('/api/reason-codes', an.reasonCodes);
  app.get('/api/feature-policy', an.featurePolicy);
  app.post('/api/economics/simulate', an.simulate);

  // Serve the built demo UI when present (production container / docker compose).
  const dist = path.join(ROOT, 'dist');
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }

  app.use((_req, _res, next) => { const err = new Error('Not found'); err.status = 404; next(err); });
  app.use((err, req, res, next) => { metrics.recordHttpError(err.status || 500); if (err.name === 'ZodError' || /contract validation/.test(err.message || '')) metrics.recordSchemaFailure(); next(err); });
  app.use(errorHandler);
  return app;
}

function swaggerHtml() {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Case Explorer API</title>
<link rel="stylesheet" href="/api/docs/assets/swagger-ui.css"></head><body><div id="swagger-ui"></div>
<script src="/api/docs/assets/swagger-ui-bundle.js"></script>
<script>window.onload=()=>{window.ui=SwaggerUIBundle({url:'/api/openapi.yaml',dom_id:'#swagger-ui'});};</script></body></html>`;
}
