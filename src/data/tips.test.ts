import { describe, expect, it } from 'vitest';
import { CROPS } from './crops';
import { TIPS, getTip } from './tips';

describe('getTip', () => {
  it('returns the tip for a known crop id', () => {
    expect(getTip('tomato')).toMatch(/stake or cage/);
  });

  it('returns undefined for an unknown crop id rather than throwing', () => {
    expect(getTip('not-a-real-crop')).toBeUndefined();
  });

  it('does not treat inherited object keys as crop ids', () => {
    expect(getTip('toString')).toBeUndefined();
    expect(getTip('__proto__')).toBeUndefined();
  });
});

describe('TIPS data integrity', () => {
  it('has a non-blank tip for every crop', () => {
    for (const crop of CROPS) {
      expect(getTip(crop.id)?.trim(), crop.id).toBeTruthy();
    }
  });

  it('has no tips for crop ids that do not exist (e.g. a typo or a renamed crop)', () => {
    const cropIds = new Set(CROPS.map((c) => c.id));
    for (const id of Object.keys(TIPS)) {
      expect(cropIds.has(id), id).toBe(true);
    }
  });
});
