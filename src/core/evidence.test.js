import { describe, it, expect } from 'vitest';
import CONFIG from '../distribution_config.json';
import { createRng } from '../utils/prng.js';
import { generateLifeScript } from './life.js';
import { synthesizeEvidence } from './evidence.js';

const rng = createRng('evidence-test');

describe('synthesizeEvidence', () => {
  it('returns all expected evidence sources', () => {
    const truth = generateLifeScript('e1', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    const sources = evidence.map(e => e.source);
    expect(sources).toContain('W2_DOCUMENT');
    expect(sources).toContain('EMPLOYER_VERIFICATION');
    expect(sources).toContain('BANK_STATEMENT');
    expect(sources).toContain('CREDIT_BUREAU');
    expect(sources).toContain('RENT_VERIFICATION');
    expect(sources).toContain('GEOGRAPHIC_VERIFICATION');
  });

  it('includes fidelity scores between 0 and 1', () => {
    const truth = generateLifeScript('e2', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    for (const doc of evidence) {
      expect(doc.fidelity).toBeGreaterThan(0);
      expect(doc.fidelity).toBeLessThanOrEqual(1);
    }
  });

  it('includes a date on every document', () => {
    const truth = generateLifeScript('e3', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    for (const doc of evidence) {
      expect(doc.date).toBeDefined();
      expect(typeof doc.date).toBe('string');
    }
  });

  it('bank statement contains checking balance and payroll deposit', () => {
    const truth = generateLifeScript('e4', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    const bank = evidence.find(e => e.source === 'BANK_STATEMENT')?.fields || {};
    expect(bank.checking_balance).toBeDefined();
    expect(bank.monthly_payroll_deposit).toBeDefined();
  });
});
