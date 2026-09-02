import { describe, it, expect } from 'vitest';
import CONFIG from '../distribution_config.json';
import { createRng } from '../utils/prng.js';
import { generateLifeScript } from './life.js';
import { synthesizeEvidence } from './evidence.js';
import {
  generateAlignmentFindings,
  generateGroundTruthFindings,
  computeDecision
} from './findings.js';

const rng = createRng('findings-test');

describe('generateAlignmentFindings', () => {
  it('returns findings for all 12 dimensions when metadata is provided', () => {
    const truth = generateLifeScript('f1', CONFIG, rng);
    const presentation = JSON.parse(JSON.stringify(truth));
    const evidence = synthesizeEvidence(truth, rng);
    const metadata = {
      documents: evidence.map(e => ({ source: e.source, days_before_submission: 10 })),
      ip_risk_score: 0.1,
      is_vpn: 0,
      is_tor: 0,
      hour_of_day: 14,
      is_business_hours: 1,
      fields_copy_pasted: 1
    };
    const findings = generateAlignmentFindings(truth, presentation, evidence, metadata);

    const dimensions = new Set(findings.map(f => f.dimension));
    expect(dimensions.has('identity')).toBe(true);
    expect(dimensions.has('employment')).toBe(true);
    expect(dimensions.has('income')).toBe(true);
    expect(dimensions.has('assets')).toBe(true);
    expect(dimensions.has('liabilities')).toBe(true);
    expect(dimensions.has('address')).toBe(true);
    expect(dimensions.has('timeline')).toBe(true);
    expect(dimensions.has('cash_flow')).toBe(true);
    expect(dimensions.has('affordability')).toBe(true);
    expect(dimensions.has('document_metadata')).toBe(true);
    expect(dimensions.has('network')).toBe(true);
    expect(dimensions.has('behavioral')).toBe(true);
  });

  it('flags income manipulation when salary is inflated', () => {
    const truth = generateLifeScript('f2', CONFIG, rng);
    const presentation = JSON.parse(JSON.stringify(truth));
    presentation.current_state.salary = truth.current_state.salary * 1.5;
    const evidence = synthesizeEvidence(truth, rng);
    const findings = generateAlignmentFindings(truth, presentation, evidence);
    const incomeFinding = findings.find(f => f.dimension === 'income');
    expect(incomeFinding.level).toMatch(/A[34]/);
  });
});

describe('generateGroundTruthFindings', () => {
  it('returns empty for clean case', () => {
    const truth = generateLifeScript('f3', CONFIG, rng);
    const presentation = JSON.parse(JSON.stringify(truth));
    const evidence = synthesizeEvidence(truth, rng);
    const findings = generateGroundTruthFindings(truth, presentation, evidence, 'NONE');
    expect(findings.length).toBe(0);
  });

  it('records income misrepresentation for INFLATION', () => {
    const truth = generateLifeScript('f4', CONFIG, rng);
    const presentation = JSON.parse(JSON.stringify(truth));
    presentation.current_state.salary = truth.current_state.salary * 1.5;
    const evidence = synthesizeEvidence(truth, rng);
    const findings = generateGroundTruthFindings(truth, presentation, evidence, 'INFLATION');
    expect(findings.some(f => f.type === 'INCOME_MISREPRESENTATION')).toBe(true);
  });
});

describe('computeDecision', () => {
  it('returns valid decision fields for clean case', () => {
    const truth = generateLifeScript('f5', CONFIG, rng);
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

  it('declines BUST_OUT cases', () => {
    const truth = generateLifeScript('f6', CONFIG, rng);
    const presentation = JSON.parse(JSON.stringify(truth));
    presentation.current_state.synthetic_identity = true;
    const evidence = synthesizeEvidence(truth, rng);
    const findings = generateAlignmentFindings(truth, presentation, evidence);
    const decision = computeDecision(truth, presentation, evidence, findings, 'BUST_OUT', 'HIGH', rng, CONFIG);
    expect(decision.expected_outcome).toBe('DECLINE');
  });

  it('declines INCOHERENT cases as A3', () => {
    const truth = generateLifeScript('f7', CONFIG, rng);
    truth.current_state.incoherent = true;
    const presentation = JSON.parse(JSON.stringify(truth));
    const evidence = synthesizeEvidence(truth, rng);
    const findings = generateAlignmentFindings(truth, presentation, evidence);
    const decision = computeDecision(truth, presentation, evidence, findings, 'INCOHERENT', 'HIGH', rng, CONFIG);
    expect(decision.expected_outcome).toBe('DECLINE');
    expect(decision.alignment_level).toBe('A3');
  });
});
