import { describe, it, expect } from 'vitest';
import CONFIG from './distribution_config.json';
import {
  createRng,
  generateCase,
  generateBlendedCase,
  generateLifeScript,
  synthesizeEvidence,
  generateAlignmentFindings,
  computeDecision,
  extractMLFeatures,
  calculateStatistics,
  casesToCsv
} from './generator.js';

const SEED = 'test-seed-42';

function caseHasEvidence(c, source) {
  return c.evidence.some(e => e.source === source);
}

function getEvidence(c, source) {
  return c.evidence.find(e => e.source === source);
}

describe('createRng', () => {
  it('produces deterministic sequences for the same seed', () => {
    const rng1 = createRng(SEED);
    const rng2 = createRng(SEED);
    for (let i = 0; i < 20; i++) {
      expect(rng1.random()).toBe(rng2.random());
    }
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = createRng(SEED);
    const rng2 = createRng('different-seed');
    const values1 = Array.from({ length: 10 }, () => rng1.random());
    const values2 = Array.from({ length: 10 }, () => rng2.random());
    expect(values1).not.toEqual(values2);
  });

  it('returns an unseeded rng when seed is undefined', () => {
    const rng = createRng();
    expect(rng.seeded).toBe(false);
    expect(typeof rng.random()).toBe('number');
  });
});

describe('generateLifeScript', () => {
  it('creates a coherent financial life structure', () => {
    const rng = createRng(SEED);
    const life = generateLifeScript('entity-1', CONFIG, rng);

    expect(life).toHaveProperty('demographics');
    expect(life).toHaveProperty('events');
    expect(life).toHaveProperty('current_state');

    expect(life.demographics).toHaveProperty('age');
    expect(life.demographics).toHaveProperty('ssn_last4');
    expect(life.demographics).toHaveProperty('zip_code');

    expect(life.current_state).toHaveProperty('salary');
    expect(life.current_state).toHaveProperty('dti');
    expect(life.current_state).toHaveProperty('credit_score');
    expect(life.current_state).toHaveProperty('checking_balance');
    expect(life.current_state).toHaveProperty('regime');
    expect(life.current_state).toHaveProperty('persona');
  });

  it('respects configured age bounds', () => {
    const rng = createRng(SEED);
    const life = generateLifeScript('entity-2', CONFIG, rng);
    const age = life.demographics.age;
    expect(age).toBeGreaterThanOrEqual(CONFIG.demographics.age.min);
    expect(age).toBeLessThanOrEqual(CONFIG.demographics.age.max);
  });
});

describe('generateCase', () => {
  it('returns a complete case object for NONE corruption', () => {
    const c = generateCase(1, CONFIG, 'NONE', 'LOW', SEED);

    expect(c).toHaveProperty('id');
    expect(c).toHaveProperty('truth');
    expect(c).toHaveProperty('presentation');
    expect(c).toHaveProperty('evidence');
    expect(c).toHaveProperty('alignment_findings');
    expect(c).toHaveProperty('ground_truth_findings');
    expect(c).toHaveProperty('label');
    expect(c).toHaveProperty('application_metadata');
  });

  it('is deterministic for the same seed', () => {
    const c1 = generateCase(1, CONFIG, 'NONE', 'LOW', SEED);
    const c2 = generateCase(1, CONFIG, 'NONE', 'LOW', SEED);
    expect(c1.truth.demographics.age).toBe(c2.truth.demographics.age);
    expect(c1.truth.current_state.salary).toBe(c2.truth.current_state.salary);
    expect(c1.truth.current_state.employer).toBe(c2.truth.current_state.employer);
  });

  it('includes all expected evidence sources', () => {
    const c = generateCase(2, CONFIG, 'NONE', 'LOW', SEED);
    const sources = ['W2_DOCUMENT', 'EMPLOYER_VERIFICATION', 'BANK_STATEMENT', 'CREDIT_BUREAU', 'RENT_VERIFICATION', 'GEOGRAPHIC_VERIFICATION'];
    for (const source of sources) {
      expect(caseHasEvidence(c, source)).toBe(true);
    }
  });
});

describe('generateBlendedCase', () => {
  it('returns a valid case with a label', () => {
    const c = generateBlendedCase(0, CONFIG, SEED);
    expect(c.label).toBeDefined();
    expect(c.label).toHaveProperty('alignment_level');
    expect(c.label).toHaveProperty('expected_outcome');
    expect(c.label).toHaveProperty('fraud_risk_level');
  });

  it('is deterministic for the same seed and id', () => {
    const c1 = generateBlendedCase(7, CONFIG, SEED);
    const c2 = generateBlendedCase(7, CONFIG, SEED);
    expect(c1.truth.current_state.salary).toBe(c2.truth.current_state.salary);
    expect(c1.label.alignment_level).toBe(c2.label.alignment_level);
  });
});

describe('corruption', () => {
  it('INFLATION increases reported salary', () => {
    const c = generateCase(3, CONFIG, 'INFLATION', 'HIGH', SEED);
    expect(c.presentation.current_state.salary).toBeGreaterThan(c.truth.current_state.salary);
    expect(c.ground_truth_findings.some(f => f.type === 'INCOME_MISREPRESENTATION')).toBe(true);
  });

  it('CONCEALMENT hides liabilities', () => {
    const c = generateCase(4, CONFIG, 'CONCEALMENT', 'HIGH', SEED);
    const truthLiabs = c.truth.events.filter(e => e.type === 'LIABILITY_OPENED').length;
    const presLiabs = c.presentation.events.filter(e => e.type === 'LIABILITY_OPENED').length;
    expect(presLiabs).toBeLessThanOrEqual(truthLiabs);
  });

  it('FABRICATION changes the employer', () => {
    const c = generateCase(5, CONFIG, 'FABRICATION', 'HIGH', SEED);
    expect(c.presentation.current_state.employer).not.toBe(c.truth.current_state.employer);
  });

  it('BUST_OUT is flagged as synthetic identity and declined', () => {
    const c = generateCase(6, CONFIG, 'BUST_OUT', 'HIGH', SEED);
    expect(c.presentation.current_state.synthetic_identity).toBe(true);
    expect(c.label.alignment_level).toBe('A5');
    expect(c.label.expected_outcome).toBe('DECLINE');
  });
});

describe('synthesizeEvidence', () => {
  it('generates evidence documents from truth', () => {
    const rng = createRng(SEED);
    const truth = generateLifeScript('entity-3', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.some(e => e.source === 'BANK_STATEMENT')).toBe(true);
    expect(evidence.some(e => e.source === 'W2_DOCUMENT')).toBe(true);
  });

  it('includes fidelity scores on every document', () => {
    const rng = createRng(SEED);
    const truth = generateLifeScript('entity-4', CONFIG, rng);
    const evidence = synthesizeEvidence(truth, rng);
    for (const doc of evidence) {
      expect(doc).toHaveProperty('fidelity');
      expect(doc.fidelity).toBeGreaterThan(0);
      expect(doc.fidelity).toBeLessThanOrEqual(1);
    }
  });
});

describe('alignment and decision', () => {
  it('generateAlignmentFindings returns 12+ dimensions', () => {
    const c = generateCase(8, CONFIG, 'NONE', 'LOW', SEED);
    expect(c.alignment_findings.length).toBeGreaterThanOrEqual(12);
    const dimensions = new Set(c.alignment_findings.map(f => f.dimension));
    expect(dimensions.has('identity')).toBe(true);
    expect(dimensions.has('income')).toBe(true);
    expect(dimensions.has('cash_flow')).toBe(true);
  });

  it('computeDecision returns expected label fields', () => {
    const rng = createRng(SEED);
    const truth = generateLifeScript('entity-5', CONFIG, rng);
    const presentation = JSON.parse(JSON.stringify(truth));
    const evidence = synthesizeEvidence(truth, rng);
    const findings = generateAlignmentFindings(truth, presentation, evidence);
    const decision = computeDecision(truth, presentation, evidence, findings, 'NONE', 'LOW', rng, CONFIG);

    expect(decision).toHaveProperty('alignment_level');
    expect(decision).toHaveProperty('fraud_risk_level');
    expect(decision).toHaveProperty('expected_outcome');
    expect(decision).toHaveProperty('reason');
    expect(['APPROVE', 'MANUAL_REVIEW', 'DECLINE']).toContain(decision.expected_outcome);
  });
});

describe('ledger invariants', () => {
  it('monthly ledger satisfies the accounting identity', () => {
    const c = generateCase(9, CONFIG, 'NONE', 'LOW', SEED);
    const ledger = c.truth.current_state.monthly_ledger || [];
    expect(ledger.length).toBeGreaterThan(0);

    for (const month of ledger) {
      const expectedEnding = month.starting_checking_balance + month.salary_deposits - month.total_outflows;
      expect(Math.abs(expectedEnding - month.ending_checking_balance)).toBeLessThanOrEqual(1);
    }
  });

  it('ledger ending balance matches evidence bank statement', () => {
    const c = generateCase(10, CONFIG, 'NONE', 'LOW', SEED);
    const bank = getEvidence(c, 'BANK_STATEMENT');
    if (!bank || !bank.fields.checking_balance) return;

    const lastMonth = c.truth.current_state.monthly_ledger?.[c.truth.current_state.monthly_ledger.length - 1];
    if (!lastMonth) return;

    expect(Math.abs(bank.fields.checking_balance - lastMonth.ending_checking_balance)).toBeLessThanOrEqual(500);
  });
});

describe('ML utilities', () => {
  it('extractMLFeatures returns the expected target columns', () => {
    const c = generateCase(11, CONFIG, 'NONE', 'LOW', SEED);
    const features = extractMLFeatures(c);
    expect(features).toHaveProperty('is_fraud');
    expect(features).toHaveProperty('outcome_approve');
    expect(features).toHaveProperty('outcome_decline');
    expect(features).toHaveProperty('outcome_manual_review');
    expect(features).toHaveProperty('alignment_level_numeric');
  });

  it('calculateStatistics summarizes a batch of cases', () => {
    const cases = Array.from({ length: 10 }, (_, i) => generateBlendedCase(i, CONFIG, SEED));
    const stats = calculateStatistics(cases);
    expect(stats).toHaveProperty('age');
    expect(stats).toHaveProperty('salary');
    expect(stats).toHaveProperty('dti');
    expect(stats).toHaveProperty('credit_score');
    expect(stats.age).toHaveProperty('mean');
    expect(stats.age).toHaveProperty('min');
    expect(stats.age).toHaveProperty('max');
  });

  it('casesToCsv produces a header and rows', () => {
    const cases = Array.from({ length: 3 }, (_, i) => generateBlendedCase(i, CONFIG, SEED));
    const csv = casesToCsv(cases);
    const lines = csv.split('\n');
    expect(lines.length).toBe(4); // header + 3 rows
    expect(lines[0]).toContain('is_fraud');
  });
});
