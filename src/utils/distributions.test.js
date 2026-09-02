import { describe, it, expect } from 'vitest';
import {
  randomNormal,
  randomLognormal,
  randomBeta,
  randomGamma,
  randomExponential,
  randomCategorical,
  clamp,
  randomInt,
  randomChoice,
  formatMoney,
  normalCDF,
  inverseNormalCDF,
  lognormalCDF,
  betaCDF,
  erf
} from './distributions.js';
import { createRng } from './prng.js';

const rng = createRng('dist-test');

describe('randomNormal', () => {
  it('produces values near the mean', () => {
    const samples = Array.from({ length: 1000 }, () => randomNormal(100, 10, rng));
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    expect(mean).toBeGreaterThan(95);
    expect(mean).toBeLessThan(105);
  });
});

describe('randomLognormal', () => {
  it('produces positive values', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomLognormal(50000, 0.4, rng)).toBeGreaterThan(0);
    }
  });
});

describe('randomBeta', () => {
  it('produces values in [0, 1]', () => {
    for (let i = 0; i < 100; i++) {
      const v = randomBeta(2, 5, rng);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('randomGamma', () => {
  it('produces positive values', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomGamma(2, 1, rng)).toBeGreaterThan(0);
    }
  });
});

describe('randomExponential', () => {
  it('produces positive values', () => {
    for (let i = 0; i < 100; i++) {
      expect(randomExponential(0.5, rng)).toBeGreaterThan(0);
    }
  });
});

describe('randomCategorical', () => {
  it('returns one of the provided categories', () => {
    const categories = ['a', 'b', 'c'];
    const probs = [0.2, 0.3, 0.5];
    for (let i = 0; i < 100; i++) {
      expect(categories).toContain(randomCategorical(categories, probs, rng));
    }
  });

  it('returns the last category when probabilities do not sum to 1', () => {
    const categories = ['a', 'b', 'c'];
    const probs = [0.1, 0.1, 0.1];
    expect(categories).toContain(randomCategorical(categories, probs, rng));
  });
});

describe('clamp', () => {
  it('clamps values to [min, max]', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('randomInt', () => {
  it('produces integers within range inclusive', () => {
    for (let i = 0; i < 100; i++) {
      const v = randomInt(5, 10, rng);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
});

describe('randomChoice', () => {
  it('returns an element from the array', () => {
    const arr = ['x', 'y', 'z'];
    for (let i = 0; i < 50; i++) {
      expect(arr).toContain(randomChoice(arr, rng));
    }
  });
});

describe('formatMoney', () => {
  it('formats numbers as dollar strings', () => {
    expect(formatMoney(1234)).toBe('$1,234');
    expect(formatMoney(0)).toBe('$0');
  });
});

describe('normalCDF', () => {
  it('returns 0.5 at the mean', () => {
    expect(normalCDF(0, 0, 1)).toBeCloseTo(0.5, 5);
  });

  it('approaches 0 far below the mean and 1 far above', () => {
    expect(normalCDF(-10, 0, 1)).toBeLessThan(0.01);
    expect(normalCDF(10, 0, 1)).toBeGreaterThan(0.99);
  });
});

describe('inverseNormalCDF', () => {
  it('is the inverse of normalCDF', () => {
    for (const p of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const x = inverseNormalCDF(p);
      expect(normalCDF(x, 0, 1)).toBeCloseTo(p, 4);
    }
  });

  it('returns -Infinity for p <= 0 and Infinity for p >= 1', () => {
    expect(inverseNormalCDF(0)).toBe(-Infinity);
    expect(inverseNormalCDF(1)).toBe(Infinity);
  });
});

describe('lognormalCDF', () => {
  it('returns 0 for non-positive x', () => {
    expect(lognormalCDF(0, 50000, 0.4)).toBe(0);
    expect(lognormalCDF(-1, 50000, 0.4)).toBe(0);
  });

  it('returns values between 0 and 1', () => {
    expect(lognormalCDF(50000, 50000, 0.4)).toBeGreaterThan(0);
    expect(lognormalCDF(50000, 50000, 0.4)).toBeLessThan(1);
  });
});

describe('betaCDF', () => {
  it('returns 0 for x <= 0 and 1 for x >= 1', () => {
    expect(betaCDF(0, 2, 5)).toBe(0);
    expect(betaCDF(-0.1, 2, 5)).toBe(0);
    expect(betaCDF(1, 2, 5)).toBe(1);
    expect(betaCDF(1.1, 2, 5)).toBe(1);
  });

  it('returns values between 0 and 1 inside (0, 1)', () => {
    const v = betaCDF(0.5, 2, 5);
    expect(v).toBeGreaterThan(0);
    expect(v).toBeLessThan(1);
  });
});

describe('erf', () => {
  it('returns 0 at 0', () => {
    expect(erf(0)).toBeCloseTo(0, 5);
  });

  it('is positive for positive inputs and negative for negative inputs', () => {
    expect(erf(1)).toBeGreaterThan(0);
    expect(erf(-1)).toBeLessThan(0);
  });
});
