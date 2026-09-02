const CORRUPTION_TYPES = new Set([
  'NONE',
  'TIMING_DRIFT',
  'INFLATION',
  'CONCEALMENT',
  'FABRICATION',
  'BUST_OUT',
  'EVIDENCE_TAMPERING',
  'INCOHERENT'
]);

const SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH']);

export function validateCaseGenerate(body) {
  const errors = [];

  const corruptionType = body.corruptionType ?? 'NONE';
  if (!CORRUPTION_TYPES.has(corruptionType)) {
    errors.push(`corruptionType must be one of: ${[...CORRUPTION_TYPES].join(', ')}`);
  }

  const severity = body.severity ?? 'LOW';
  if (!SEVERITIES.has(severity)) {
    errors.push(`severity must be one of: ${[...SEVERITIES].join(', ')}`);
  }

  const seed = body.seed !== undefined ? body.seed : undefined;
  if (seed !== undefined && typeof seed !== 'string' && typeof seed !== 'number') {
    errors.push('seed must be a string or number');
  }

  return { valid: errors.length === 0, errors, data: { corruptionType, severity, seed } };
}

export function validateBatchGenerate(body) {
  const errors = [];

  if (body.count === undefined) {
    errors.push('count is required');
  } else {
    const count = parseInt(body.count, 10);
    if (Number.isNaN(count) || count < 1 || count > 10_000) {
      errors.push('count must be an integer between 1 and 10,000');
    }
  }

  const seed = body.seed !== undefined ? body.seed : undefined;
  if (seed !== undefined && typeof seed !== 'string' && typeof seed !== 'number') {
    errors.push('seed must be a string or number');
  }

  const adversarial = body.adversarial === true;

  return {
    valid: errors.length === 0,
    errors,
    data: {
      count: parseInt(body.count, 10),
      seed,
      adversarial
    }
  };
}
