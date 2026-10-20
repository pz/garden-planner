import { describe, expect, it } from 'vitest';
import type { CropFamily, SowMethod } from '../types';
import { CROPS, getCrop } from './crops';

const CROP_FAMILIES: CropFamily[] = [
  'fruiting',
  'brassica',
  'root',
  'allium',
  'legume',
  'leafy',
  'cucurbit',
  'herb',
];
const SOW_METHODS: SowMethod[] = ['transplant', 'direct-sow'];

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

  // crops.json is loaded with a type assertion, not runtime-validated, so a hand-edit
  // with an unrecognized family/sowMethod string wouldn't be caught by TypeScript.
  it('only uses recognized family and sowMethod values', () => {
    for (const crop of CROPS) {
      expect(CROP_FAMILIES).toContain(crop.family);
      expect(SOW_METHODS).toContain(crop.sowMethod);
    }
  });

  it('gives every crop a positive typical height and a recognized sun need', () => {
    for (const crop of CROPS) {
      expect(crop.heightIn, crop.id).toBeGreaterThan(0);
      expect(['full', 'partial'], crop.id).toContain(crop.sunNeed);
    }
  });

  it('only lists crops to avoid that exist, never the crop itself, each with a reason and a recognized evidence level', () => {
    const ids = new Set(CROPS.map((c) => c.id));
    for (const crop of CROPS) {
      const seen = new Set<string>();
      for (const avoid of crop.avoidNear ?? []) {
        expect(ids.has(avoid.cropId), `${crop.id} avoids unknown crop ${avoid.cropId}`).toBe(true);
        expect(avoid.cropId, `${crop.id} avoids itself`).not.toBe(crop.id);
        expect(seen.has(avoid.cropId), `${crop.id} lists ${avoid.cropId} twice`).toBe(false);
        seen.add(avoid.cropId);
        expect(avoid.reason.trim(), crop.id).not.toBe('');
        expect(['extension', 'anecdotal'], crop.id).toContain(avoid.evidence);
      }
    }
  });

  it("does not list the same pair from both sides (the pair counts whichever side lists it)", () => {
    for (const a of CROPS) {
      for (const avoid of a.avoidNear ?? []) {
        const b = CROPS.find((c) => c.id === avoid.cropId)!;
        expect((b.avoidNear ?? []).some((x) => x.cropId === a.id), `${a.id} and ${b.id} both list each other`).toBe(false);
      }
    }
  });
});
