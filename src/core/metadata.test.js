import { describe, it, expect } from 'vitest';
import { createRng } from '../utils/prng.js';
import { generateApplicationMetadata } from './metadata.js';

const rng = createRng('metadata-test');

describe('generateApplicationMetadata', () => {
  it('returns expected metadata fields', () => {
    const meta = generateApplicationMetadata('2026-08-01', 'NONE', 'LOW', rng);

    expect(meta).toHaveProperty('submitted');
    expect(meta).toHaveProperty('hour_of_day');
    expect(meta).toHaveProperty('day_of_week');
    expect(meta).toHaveProperty('is_business_hours');
    expect(meta).toHaveProperty('device_fingerprint');
    expect(meta).toHaveProperty('ip_address');
    expect(meta).toHaveProperty('ip_risk_score');
    expect(meta).toHaveProperty('is_vpn');
    expect(meta).toHaveProperty('is_tor');
    expect(meta).toHaveProperty('typing_speed_wpm');
    expect(meta).toHaveProperty('fields_copy_pasted');
    expect(meta).toHaveProperty('session_duration_seconds');
    expect(meta).toHaveProperty('used_autofill');
    expect(meta).toHaveProperty('documents');
  });

  it('includes document metadata for expected sources', () => {
    const meta = generateApplicationMetadata('2026-08-01', 'NONE', 'LOW', rng);
    const sources = meta.documents.map(d => d.source);
    expect(sources).toContain('W2_DOCUMENT');
    expect(sources).toContain('BANK_STATEMENT');
    expect(sources).toContain('CREDIT_BUREAU');
    expect(sources).toContain('EMPLOYER_VERIFICATION');
  });

  it('produces higher risk signals for fraud cases', () => {
    const cleanMeta = generateApplicationMetadata('2026-08-01', 'NONE', 'LOW', createRng('clean'));
    const fraudMeta = generateApplicationMetadata('2026-08-01', 'FABRICATION', 'HIGH', createRng('fraud'), 1.0);
    expect(fraudMeta.ip_risk_score).toBeGreaterThanOrEqual(cleanMeta.ip_risk_score);
  });

  it('has valid boolean flags', () => {
    const meta = generateApplicationMetadata('2026-08-01', 'NONE', 'LOW', rng);
    expect([0, 1]).toContain(meta.is_business_hours);
    expect([0, 1]).toContain(meta.is_vpn);
    expect([0, 1]).toContain(meta.is_tor);
    expect([0, 1]).toContain(meta.used_autofill);
  });
});
