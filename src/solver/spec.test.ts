import { describe, expect, it } from 'vitest';
import type { GardenPlan } from '../types';
import { createPlan } from '../core/reducer';
import { makeCustomCrop, setCustomCrops } from '../data/crops';
import { parseSpec } from './spec';

const plan = (): GardenPlan => ({
  ...createPlan('t'),
  beds: [
    { id: 'a', name: 'A', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 },
    { id: 'b', name: 'B', shape: 'rect', cx: 48, cy: 100, widthIn: 96, heightIn: 48, rotationDeg: 0 },
  ],
  plants: [{ id: 'p1', bedId: 'a', cropId: 'tomato', x: 10, y: 10, groupId: 'g1' }],
});

const ok = { mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }] };
const errorsOf = (raw: unknown) => {
  const r = parseSpec(raw, plan());
  return r.ok ? [] : r.errors;
};
const pathsAndCodes = (raw: unknown) => errorsOf(raw).map((e) => [e.code, e.path]);

describe('parseSpec', () => {
  it('accepts a minimal spec and a full one', () => {
    expect(parseSpec(ok, plan())).toEqual({ ok: true, spec: ok });
    const full = {
      mode: 'adjust',
      scope: { bedIds: ['a', 'b'] },
      locked: ['g1'],
      exclude: ['beans'],
      fillRatio: 1,
      prefs: { spacing: 0, shade: 1, companions: 0.5, clustering: 0, stability: 1 },
      demands: [{ cropId: 'tomato', weight: 0.4, min: 2, max: 2, bedIds: ['a'] }],
    };
    expect(parseSpec(full, plan()).ok).toBe(true);
  });

  it('rejects a non-object', () => {
    for (const raw of [null, [], 'fill', 3]) expect(pathsAndCodes(raw)).toEqual([['invalid_command', '']]);
  });

  it('reports every error at once, with JSON pointers', () => {
    expect(pathsAndCodes({ mode: 'nope', demands: [{ cropId: 'ghost', weight: 0 }, { weight: 1, extra: 1 }], bogus: 1 })).toEqual([
      ['invalid_command', '/bogus'],
      ['invalid_command', '/mode'],
      ['unknown_crop', '/demands/0/cropId'],
      ['invalid_command', '/demands/0/weight'],
      ['invalid_command', '/demands/1/extra'],
      ['invalid_command', '/demands/1/cropId'],
    ]);
  });

  it('requires mode and demands', () => {
    expect(pathsAndCodes({})).toEqual([
      ['invalid_command', '/mode'],
      ['invalid_command', '/demands'],
    ]);
    expect(pathsAndCodes({ mode: 'fill', demands: [] })).toEqual([['invalid_command', '/demands']]);
    expect(pathsAndCodes({ mode: 'fill', demands: 'tomato' })).toEqual([['invalid_command', '/demands']]);
  });

  it('puts every error message in the API shape, starting with its path', () => {
    for (const e of errorsOf({ mode: 'x', demands: [] })) expect(e.message.startsWith(e.path)).toBe(true);
  });

  describe('weights, min and max', () => {
    const demand = (d: object) => ({ mode: 'fill', demands: [{ cropId: 'tomato', weight: 1, ...d }] });
    it('needs a weight above 0', () => {
      expect(parseSpec(demand({ weight: 0.0001 }), plan()).ok).toBe(true);
      for (const weight of [0, -1, '1', null, Infinity]) expect(pathsAndCodes(demand({ weight }))).toEqual([['invalid_command', '/demands/0/weight']]);
    });
    it('takes whole numbers for min and max, 0 or more', () => {
      expect(parseSpec(demand({ min: 0, max: 0 }), plan()).ok).toBe(true);
      expect(pathsAndCodes(demand({ min: -1 }))).toEqual([['invalid_command', '/demands/0/min']]);
      expect(pathsAndCodes(demand({ max: 1.5 }))).toEqual([['invalid_command', '/demands/0/max']]);
    });
    it('allows min equal to max, not above it', () => {
      expect(parseSpec(demand({ min: 3, max: 3 }), plan()).ok).toBe(true);
      expect(pathsAndCodes(demand({ min: 4, max: 3 }))).toEqual([['invalid_command', '/demands/0/min']]);
    });
  });

  describe('crops', () => {
    it('reports unknown crops in demands and exclude as unknown_crop', () => {
      expect(pathsAndCodes({ mode: 'fill', exclude: ['ghost'], demands: [{ cropId: 'ghost', weight: 1 }] })).toEqual([
        ['unknown_crop', '/exclude/0'],
        ['unknown_crop', '/demands/0/cropId'],
      ]);
    });
    it('rejects a crop demanded twice, or demanded and excluded', () => {
      expect(pathsAndCodes({ mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'tomato', weight: 2 }] })).toEqual([['invalid_command', '/demands/1/cropId']]);
      expect(pathsAndCodes({ mode: 'fill', exclude: ['tomato'], demands: [{ cropId: 'tomato', weight: 1 }] })).toEqual([['invalid_command', '/demands/0/cropId']]);
    });
    it('accepts a registered custom crop and rejects it once it is gone', () => {
      const raw = { mode: 'fill', demands: [{ cropId: 'custom-x', weight: 1 }] };
      setCustomCrops([makeCustomCrop({ id: 'custom-x', name: 'X', spacingIn: 10, look: {} })]);
      try {
        expect(parseSpec(raw, plan()).ok).toBe(true);
      } finally {
        setCustomCrops([]);
      }
      expect(pathsAndCodes(raw)).toEqual([['unknown_crop', '/demands/0/cropId']]);
    });
  });

  describe('beds and scope', () => {
    it('reports unknown beds', () => {
      expect(pathsAndCodes({ ...ok, scope: { bedIds: ['a', 'zz'] } })).toEqual([['unknown_bed', '/scope/bedIds/1']]);
      expect(pathsAndCodes({ mode: 'fill', demands: [{ cropId: 'tomato', weight: 1, bedIds: ['zz'] }] })).toEqual([['unknown_bed', '/demands/0/bedIds/0']]);
    });
    it('rejects an empty bed list instead of reading it as "nowhere"', () => {
      expect(pathsAndCodes({ ...ok, scope: { bedIds: [] } })).toEqual([['invalid_command', '/scope/bedIds']]);
      expect(pathsAndCodes({ mode: 'fill', demands: [{ cropId: 'tomato', weight: 1, bedIds: [] }] })).toEqual([['invalid_command', '/demands/0/bedIds']]);
    });
    it('requires a demand’s beds to be inside the scope', () => {
      const spec = (bedIds: string[]) => ({ mode: 'fill', scope: { bedIds: ['a'] }, demands: [{ cropId: 'tomato', weight: 1, bedIds }] });
      expect(parseSpec(spec(['a']), plan()).ok).toBe(true);
      expect(pathsAndCodes(spec(['a', 'b']))).toEqual([['invalid_command', '/demands/0/bedIds/1']]);
    });
    it('treats an absent scope as every bed', () => {
      expect(parseSpec({ mode: 'fill', demands: [{ cropId: 'tomato', weight: 1, bedIds: ['a', 'b'] }] }, plan()).ok).toBe(true);
    });
    it('rejects unknown fields in the scope', () => {
      expect(pathsAndCodes({ ...ok, scope: { beds: ['a'] } })).toEqual([['invalid_command', '/scope/beds']]);
    });
  });

  it('reports locked groupIds that name no patch as unknown_id', () => {
    expect(parseSpec({ ...ok, locked: ['g1'] }, plan()).ok).toBe(true);
    expect(pathsAndCodes({ ...ok, locked: ['g1', 'nope'] })).toEqual([['unknown_id', '/locked/1']]);
  });

  describe('fillRatio and prefs', () => {
    it('takes a fillRatio above 0 and at most 1', () => {
      for (const fillRatio of [0.01, 1]) expect(parseSpec({ ...ok, fillRatio }, plan()).ok).toBe(true);
      for (const fillRatio of [0, 1.01, -1, '1']) expect(pathsAndCodes({ ...ok, fillRatio })).toEqual([['invalid_command', '/fillRatio']]);
    });
    it('takes prefs from 0 to 1 and rejects unknown ones', () => {
      expect(parseSpec({ ...ok, prefs: { spacing: 0, stability: 1 } }, plan()).ok).toBe(true);
      expect(pathsAndCodes({ ...ok, prefs: { spacing: 1.1, speed: 1 } })).toEqual([
        ['invalid_command', '/prefs/speed'],
        ['invalid_command', '/prefs/spacing'],
      ]);
    });
  });
});
