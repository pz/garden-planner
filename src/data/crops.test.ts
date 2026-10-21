import { describe, expect, it } from 'vitest';
import type { CropFamily, SowMethod } from '../types';
import { afterEach } from 'vitest';
import { CROPS, MAX_CUSTOM_LENGTH_IN, allCrops, customCrops, findCrop, getCrop, hasSchedule, makeCustomCrop, parseCustomCrop, setCustomCrops } from './crops';

const CROP_FAMILIES: CropFamily[] = [
  'nightshade',
  'brassica',
  'root',
  'allium',
  'legume',
  'leafy',
  'cucurbit',
  'herb',
  'flower',
  'grain',
  'perennial',
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

describe('user-made plants', () => {
  afterEach(() => setCustomCrops([]));
  const make = (over: Record<string, unknown> = {}) => ({ ...makeCustomCrop({ id: 'custom-1', name: 'Mystery', spacingIn: 8, look: { shape: 'mound', leaf: 'sage' } }), ...over });

  it('are found next to the built-in crops once registered, and gone once cleared', () => {
    expect(findCrop('custom-1')).toBeUndefined();
    setCustomCrops([make()]);
    expect(getCrop('custom-1').name).toBe('Mystery');
    expect(allCrops().map((c) => c.id)).toEqual([...CROPS.map((c) => c.id), 'custom-1']);
    expect(customCrops().map((c) => c.id)).toEqual(['custom-1']);
    setCustomCrops([]);
    expect(() => getCrop('custom-1')).toThrow(/Unknown crop/);
  });

  it('can never shadow a built-in crop', () => {
    setCustomCrops([make({ id: 'tomato' })]);
    expect(customCrops()).toEqual([]);
    expect(getCrop('tomato').spacingIn).toBe(24);
  });

  it('are built with no schedule, and a patch default that follows tight spacing', () => {
    const tight = make({}) as ReturnType<typeof makeCustomCrop>;
    expect(hasSchedule(tight)).toBe(false);
    expect(hasSchedule(getCrop('tomato'))).toBe(true);
    expect(makeCustomCrop({ id: 'custom-a', name: 'A', spacingIn: 6, look: {} }).defaultPatch).toBe(true);
    expect(makeCustomCrop({ id: 'custom-a', name: 'A', spacingIn: 6.5, look: {} }).defaultPatch).toBe(false);
  });

  it('start with an unknown height and never get shade warnings of their own, unless the gardener gives a height', () => {
    const noHeight = makeCustomCrop({ id: 'custom-a', name: 'A', spacingIn: 8, look: {} });
    expect([noHeight.heightIn, noHeight.sunNeed]).toEqual([0, 'partial']);
    expect(makeCustomCrop({ id: 'custom-a', name: 'A', spacingIn: 8, heightIn: 30, look: {} }).heightIn).toBe(30);
    expect(parseCustomCrop(noHeight)).toEqual(noHeight); // a stored 0 reads back as "unknown", not as an error
  });

  it('are read back only if well-formed: a name, an id of the right kind, sane lengths, string looks', () => {
    expect(parseCustomCrop(make())).toEqual(make());
    expect(parseCustomCrop(make({ name: '   ' }))).toBeNull();
    expect(parseCustomCrop(make({ id: 'tomato' }))).toBeNull();
    expect(parseCustomCrop(make({ id: 'custom-' }))).toBeNull();
    expect(parseCustomCrop(make({ spacingIn: 0 }))).toBeNull();
    expect(parseCustomCrop(make({ spacingIn: MAX_CUSTOM_LENGTH_IN }))).not.toBeNull();
    expect(parseCustomCrop(make({ spacingIn: MAX_CUSTOM_LENGTH_IN + 0.01 }))).toBeNull();
    expect(parseCustomCrop(make({ heightIn: -1 }))).toBeNull();
    expect(parseCustomCrop(make({ look: { shape: 3 } }))).toBeNull();
    expect(parseCustomCrop(make({ look: 'oval' }))).toBeNull();
    expect(parseCustomCrop(null)).toBeNull();
  });

  it('are rebuilt from known fields, so stray ones from a file are dropped', () => {
    const read = parseCustomCrop({ ...make(), family: 'brassica', daysToMaturity: 5, evil: true, look: { shape: 'mound', junk: 'x' } });
    expect(read).toEqual(make({ look: { shape: 'mound' } }));
  });
});
