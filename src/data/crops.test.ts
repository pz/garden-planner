import { describe, expect, it } from 'vitest';
import { CROPS, getCrop } from './crops';

describe('getCrop', () => {
  it('returns the crop definition for a known id', () => {
    expect(getCrop('tomato').name).toBe('Tomato');
  });

  it('throws for an unknown crop id rather than returning undefined', () => {
    expect(() => getCrop('not-a-real-crop')).toThrow(/Unknown crop/);
  });
});

describe('CROPS data integrity', () => {
  it('has unique ids', () => {
    const ids = CROPS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every transplant crop both a start-indoors and transplant offset semantics, and every direct-sow crop a sow offset', () => {
    for (const crop of CROPS) {
      if (crop.sowMethod === 'transplant') {
        expect(crop.startIndoorsWeeksBeforeLastFrost).toBeDefined();
      } else {
        expect(crop.directSowWeeksRelativeToLastFrost).toBeDefined();
      }
    }
  });

  it('has positive spacing and days-to-maturity for every crop', () => {
    for (const crop of CROPS) {
      expect(crop.spacingIn).toBeGreaterThan(0);
      expect(crop.daysToMaturity).toBeGreaterThan(0);
    }
  });
});
