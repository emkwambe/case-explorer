import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';

const API_KEY = 'test-key';

process.env.API_KEYS = API_KEY;
process.env.RATE_LIMIT_WINDOW_MS = '60000';
process.env.RATE_LIMIT_MAX_REQUESTS = '100';

describe('API', () => {
  let app;

  beforeEach(() => {
    app = createApp();
  });

  describe('GET /api/health', () => {
    it('returns ok without authentication', async () => {
      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.timestamp).toBeDefined();
    });
  });

  describe('authentication', () => {
    it('returns 401 when API key is missing', async () => {
      const res = await request(app).get('/api/config');
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Unauthorized');
    });

    it('returns 401 when API key is invalid', async () => {
      const res = await request(app).get('/api/config').set('X-API-Key', 'bad-key');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/config', () => {
    it('returns the distribution config', async () => {
      const res = await request(app).get('/api/config').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('corruption');
      expect(res.body).toHaveProperty('personas');
    });
  });

  describe('POST /api/cases/generate', () => {
    it('generates a single case', async () => {
      const res = await request(app)
        .post('/api/cases/generate')
        .set('X-API-Key', API_KEY)
        .send({ corruptionType: 'NONE', severity: 'LOW', seed: 'api-test' });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('id');
      expect(res.body).toHaveProperty('truth');
      expect(res.body).toHaveProperty('presentation');
      expect(res.body).toHaveProperty('evidence');
      expect(res.body).toHaveProperty('label');
    });

    it('generates a fraudulent case', async () => {
      const res = await request(app)
        .post('/api/cases/generate')
        .set('X-API-Key', API_KEY)
        .send({ corruptionType: 'INFLATION', severity: 'HIGH', seed: 'api-test' });

      expect(res.status).toBe(200);
      expect(res.body.presentation.current_state.salary).toBeGreaterThan(res.body.truth.current_state.salary);
    });

    it('returns 400 for invalid corruption type', async () => {
      const res = await request(app)
        .post('/api/cases/generate')
        .set('X-API-Key', API_KEY)
        .send({ corruptionType: 'INVALID', severity: 'LOW' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('corruptionType');
    });
  });

  describe('POST /api/batch/generate', () => {
    it('generates a batch of cases', async () => {
      const res = await request(app)
        .post('/api/batch/generate')
        .set('X-API-Key', API_KEY)
        .send({ count: 5, seed: 'batch-test' });

      expect(res.status).toBe(200);
      expect(res.body.cases).toHaveLength(5);
      expect(res.body.metadata.count).toBe(5);
      expect(res.body.metadata.statistics).toBeDefined();
    });

    it('returns 400 when count is missing', async () => {
      const res = await request(app)
        .post('/api/batch/generate')
        .set('X-API-Key', API_KEY)
        .send({ seed: 'batch-test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('count');
    });

    it('returns 400 when count exceeds the maximum', async () => {
      const res = await request(app)
        .post('/api/batch/generate')
        .set('X-API-Key', API_KEY)
        .send({ count: 50_000 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('count');
    });
  });

  describe('rate limiting headers', () => {
    it('includes rate limit headers on protected routes', async () => {
      const res = await request(app).get('/api/config').set('X-API-Key', API_KEY);
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBeDefined();
      expect(res.headers['x-ratelimit-remaining']).toBeDefined();
      expect(res.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app).get('/api/unknown').set('X-API-Key', API_KEY);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
