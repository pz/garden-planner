import { describe, expect, it } from 'vitest';
import type { Bed, PlantInstance } from '../types';
import { makeCustomCrop, setCustomCrops } from '../data/crops';
import { discsOf } from './placement';
import { summarizeSelection } from './selectionSummary';

const A: Bed = { id: 'a', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 };
const B: Bed = { id: 'b', name: 'Side', shape: 'rect', cx: 200, cy: 24, widthIn: 40, heightIn: 40, rotationDeg: 0 };
const p = (id: string, over: Partial<PlantInstance> = {}): PlantInstance => ({ id, bedId: 'a', cropId: 'carrot', x: 10, y: 10, groupId: id, ...over });
const sum = (plants: PlantInstance[], selected: string[]) => summarizeSelection(plants, [A, B], selected, discsOf(plants, [A, B]));

describe('summarizeSelection', () => {
  it('is null when nothing is selected', () => {
    expect(sum([p('a')], [])).toBeNull();
    expect(sum([p('a')], ['gone'])).toBeNull();
  });

  it('describes a single plant with its crop facts and bed', () => {
    const s = sum([p('a', { cropId: 'tomato' })], ['a'])!;
    expect(s).toMatchObject({ count: 1, kind: 'plant', cropId: 'tomato', spacingIn: 24, harvestDays: 70, bedNames: ['Bed 1'], areaIn: null, canGroup: false, canUngroup: false, partOfPatch: null });
  });

  it('calls a whole patch of one crop a patch and gives the area it covers', () => {
    const plants = [p('a', { groupId: 'g', x: 10 }), p('b', { groupId: 'g', x: 16 }), p('c', { groupId: 'g', x: 22 })];
    const s = sum(plants, ['a', 'b', 'c'])!;
    expect(s).toMatchObject({ kind: 'patch', cropId: 'carrot', mixedPatch: false, canUngroup: true, canGroup: false });
    expect(s.areaIn!.w).toBeCloseTo(15); // 12 between centers + a ring's width of 3
    expect(s.areaIn!.h).toBeCloseTo(3);
  });

  it('reports one plant picked from a patch, with the patch size', () => {
    const plants = [p('a', { groupId: 'g' }), p('b', { groupId: 'g', x: 16 })];
    expect(sum(plants, ['b'])).toMatchObject({ kind: 'plant', partOfPatch: 2 });
  });

  it('calls a patch of several crops a mixed patch, listing them most first', () => {
    const plants = [p('a', { groupId: 'g', cropId: 'kale' }), p('b', { groupId: 'g', cropId: 'basil', x: 40 }), p('c', { groupId: 'g', cropId: 'basil', x: 60 })];
    const s = sum(plants, ['a', 'b', 'c'])!;
    expect(s).toMatchObject({ kind: 'patch', mixedPatch: true, cropId: null, spacingIn: null });
    expect(s.crops).toEqual([{ cropId: 'basil', count: 2 }, { cropId: 'kale', count: 1 }]);
  });

  it('offers Group for loose plants in one bed, but not across beds, and Ungroup only for a whole patch', () => {
    const loose = [p('a'), p('b', { x: 40 })];
    expect(sum(loose, ['a', 'b'])).toMatchObject({ canGroup: true, canUngroup: false });
    const split = [p('a'), p('b', { bedId: 'b', x: 10 })];
    expect(sum(split, ['a', 'b'])).toMatchObject({ canGroup: false, bedNames: ['Bed 1', 'Side'] });
    const half = [p('a', { groupId: 'g' }), p('b', { groupId: 'g', x: 40 }), p('c', { x: 70 })];
    expect(sum(half, ['a', 'c'])).toMatchObject({ canGroup: true, canUngroup: false });
  });

  it('describes a user-made plant with its height, and no harvest', () => {
    setCustomCrops([makeCustomCrop({ id: 'custom-x', name: 'Mine', spacingIn: 8, heightIn: 30, look: {} })]);
    try {
      expect(sum([p('a', { cropId: 'custom-x' })], ['a'])).toMatchObject({ custom: true, heightIn: 30, harvestDays: null, spacingIn: 8 });
      expect(sum([p('a')], ['a'])).toMatchObject({ custom: false, heightIn: null });
    } finally {
      setCustomCrops([]);
    }
  });
});
