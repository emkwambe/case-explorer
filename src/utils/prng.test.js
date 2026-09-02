import { describe, it, expect } from 'vitest';
import { createRng } from './prng.js';

describe('createRng', () => {
  it('returns deterministic values for the same string seed', () => {
    const rng1 = createRng('seed-a');
    const rng2 = createRng('seed-a');
    const values1 = Array.from({ length: 50 }, () => rng1.random());
    const values2 = Array.from({ length: 50 }, () => rng2.random());
    expect(values1).toEqual(values2);
  });

  it('returns deterministic values for the same numeric seed', () => {
    const rng1 = createRng(42);
    const rng2 = createRng(42);
    expect(rng1.random()).toBe(rng2.random());
  });

  it('produces values in [0, 1)', () => {
    const rng = createRng('seed-b');
    for (let i = 0; i < 100; i++) {
      const v = rng.random();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = createRng('seed-a');
    const rng2 = createRng('seed-b');
    const values1 = Array.from({ length: 20 }, () => rng1.random());
    const values2 = Array.from({ length: 20 }, () => rng2.random());
    expect(values1).not.toEqual(values2);
  });

  it('marks seeded as false when no seed is provided', () => {
    const rng = createRng();
    expect(rng.seeded).toBe(false);
    expect(typeof rng.random()).toBe('number');
  });

  it('marks seeded as true when a seed is provided', () => {
    expect(createRng('x').seeded).toBe(true);
    expect(createRng(0).seeded).toBe(true);
  });
});
