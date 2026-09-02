import { describe, it, expect } from 'vitest';
import CONFIG from '../distribution_config.json';
import { createRng } from '../utils/prng.js';
import { generateLifeScript } from './life.js';
import { synthesizeEvidence } from './evidence.js';
import {
  corruptPresentation,
  tamperEvidence,
  corruptWorldTruth
} from './corruption.js';

const rng = createRng('corruption-test');

describe('corruptPresentation', () => {
  it('returns truth unchanged for NONE', () => {
    const truth = generateLifeScript('e1', CONFIG, rng);
    const pres = corruptPresentation(truth, 'NONE', 'LOW', CONFIG, rng);
    expect(pres.current_state.salary).toBe(truth.current_state.salary);
    expect(pres.current_state.employer).toBe(truth.current_state.employer);
  });

  it('inflates salary for INFLATION', () => {
    const truth = generateLifeScript('e2', CONFIG, rng);
    const pres = corruptPresentation(truth, 'INFLATION', 'HIGH', CONFIG, rng);
    expect(pres.current_state.salary).toBeGreaterThan(truth.current_state.salary);
  });

  it('hides liabilities for CONCEALMENT', () => {
    const truth = generateLifeScript('e3', CONFIG, rng);
    const pres = corruptPresentation(truth, 'CONCEALMENT', 'HIGH', CONFIG, rng);
    const truthLiabs = truth.events.filter(e => e.type === 'LIABILITY_OPENED').length;
    const presLiabs = pres.events.filter(e => e.type === 'LIABILITY_OPENED').length;
    expect(presLiabs).toBeLessThanOrEqual(truthLiabs);
    expect(pres.current_state.monthly_obligations).toBeLessThanOrEqual(truth.current_state.monthly_obligations);
  });

  it('changes employer for FABRICATION', () => {
    const truth = generateLifeScript('e4', CONFIG, rng);
    const pres = corruptPresentation(truth, 'FABRICATION', 'HIGH', CONFIG, rng);
    expect(pres.current_state.employer).not.toBe(truth.current_state.employer);
  });

  it('creates synthetic identity for BUST_OUT', () => {
    const truth = generateLifeScript('e5', CONFIG, rng);
    const pres = corruptPresentation(truth, 'BUST_OUT', 'HIGH', CONFIG, rng);
    expect(pres.current_state.synthetic_identity).toBe(true);
    expect(pres.current_state.credit_score).toBeGreaterThanOrEqual(720);
  });
});

describe('tamperEvidence', () => {
  it('alters bank statement evidence', () => {
    const truth = generateLifeScript('e6', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    const tampered = tamperEvidence(truth, evidence, 'HIGH', rng);
    const bank = tampered.find(e => e.source === 'BANK_STATEMENT')?.fields || {};
    expect(bank.checking_balance).toBeGreaterThan(truth.current_state.checking_balance);
    expect(bank.recent_large_deposits.length).toBeGreaterThan(0);
  });
});

describe('corruptWorldTruth', () => {
  it('marks truth as incoherent', () => {
    const truth = generateLifeScript('e7', CONFIG, rng);
    const corrupted = corruptWorldTruth(truth, rng);
    expect(corrupted.current_state.incoherent).toBe(true);
  });

  it('changes an incoherent world field or event', () => {
    const truth = generateLifeScript('e8', CONFIG, rng);
    const originalObligations = truth.current_state.monthly_obligations;
    const originalDti = truth.current_state.dti;
    const originalW2Wages = truth.current_state.annual_w2_wages;
    const originalEventCount = truth.events.length;

    const corrupted = corruptWorldTruth(truth, rng);
    const changed =
      corrupted.current_state.monthly_obligations !== originalObligations ||
      corrupted.current_state.dti !== originalDti ||
      corrupted.current_state.annual_w2_wages !== originalW2Wages ||
      corrupted.events.length !== originalEventCount;
    expect(changed).toBe(true);
  });
});
