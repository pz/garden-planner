import { describe, expect, it } from 'vitest';
import { makeCustomCrop } from '../../data/crops';
import { EMPTY_LIBRARY, mergeCustomCrops, newCustomCropId, parseCustomCrops, removeCustomCrop, upsertCustomCrop } from './customCrops';

const crop = (id: string, name = id, spacingIn = 8) => makeCustomCrop({ id: `custom-${id}`, name, spacingIn, look: { shape: 'mound' } });
const lib = (...ids: string[]) => ({ version: 1 as const, crops: ids.map((i) => crop(i)) });

describe('parseCustomCrops', () => {
  it('falls back to an empty library for nothing, junk, or the wrong version', () => {
    for (const raw of [null, '', '{nope', '[]', JSON.stringify({ version: 2, crops: [] }), JSON.stringify({ version: 1, crops: 'x' })]) {
      expect(parseCustomCrops(raw)).toEqual(EMPTY_LIBRARY);
    }
  });

  it('keeps well-formed plants, drops malformed ones and repeats', () => {
    const raw = JSON.stringify({ version: 1, crops: [crop('a'), { id: 'tomato' }, crop('a', 'again'), crop('b')] });
    expect(parseCustomCrops(raw).crops.map((c) => [c.id, c.name])).toEqual([['custom-a', 'a'], ['custom-b', 'b']]);
  });
});

describe('editing the library', () => {
  it('adds a plant, and replaces one with the same id in place', () => {
    const added = upsertCustomCrop(lib('a', 'b'), crop('c'));
    expect(added.crops.map((c) => c.id)).toEqual(['custom-a', 'custom-b', 'custom-c']);
    const edited = upsertCustomCrop(added, crop('a', 'Renamed'));
    expect(edited.crops.map((c) => c.name)).toEqual(['Renamed', 'b', 'c']);
  });

  it('removes a plant, and returns the same object when it was not there', () => {
    const l = lib('a', 'b');
    expect(removeCustomCrop(l, 'custom-a').crops.map((c) => c.id)).toEqual(['custom-b']);
    expect(removeCustomCrop(l, 'custom-zz')).toBe(l);
  });
});

describe('mergeCustomCrops', () => {
  it('adds only the plants the library lacks, and never overwrites a local one', () => {
    const l = { version: 1 as const, crops: [crop('a', 'Mine')] };
    const merged = mergeCustomCrops(l, [crop('a', 'Theirs'), crop('b'), crop('b', 'dup')]);
    expect(merged.crops.map((c) => [c.id, c.name])).toEqual([['custom-a', 'Mine'], ['custom-b', 'b']]);
  });

  it('returns the same object when there is nothing new', () => {
    const l = lib('a');
    expect(mergeCustomCrops(l, [crop('a')])).toBe(l);
    expect(mergeCustomCrops(l, [])).toBe(l);
  });
});

describe('newCustomCropId', () => {
  it('is prefixed so it can never be a built-in id, and short', () => {
    expect(newCustomCropId(() => '1234567890abcdef')).toBe('custom-12345678');
  });
});
