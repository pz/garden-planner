import { describe, expect, it } from 'vitest';
import { mulberry32 } from './random';

describe('mulberry32', () => {
  it('gives the same sequence for the same seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('gives different sequences for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('stays in [0, 1)', () => {
    const next = mulberry32(7);
    for (let i = 0; i < 10_000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('treats the seed as an unsigned 32-bit integer', () => {
    expect(mulberry32(-1)()).toBe(mulberry32(0xffffffff)());
    expect(mulberry32(2 ** 32 + 5)()).toBe(mulberry32(5)());
  });

  it('is pinned to known values so a change to the generator is noticed', () => {
    const next = mulberry32(1);
    expect(next()).toBeCloseTo(0.6270739405881613, 12);
  });
});
