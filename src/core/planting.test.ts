import { describe, expect, it } from 'vitest';
import { rectOutline } from './geometry';
import {
  OCCUPIED_FACTOR,
  brushSpots,
  canPlantAt,
  centroid,
  extent,
  hitPlant,
  isOccupied,
  marqueeSelect,
  selectOnPress,
  snapToGrid,
  stampOf,
  stampSpots,
  type Disc,
} from './planting';

const disc = (id: string, x: number, y: number, r = 5, groupId = id): Disc => ({ id, x, y, r, groupId });

describe('isOccupied', () => {
  it('is true just inside the occupied distance and false exactly at it', () => {
    const limit = (5 + 5) * OCCUPIED_FACTOR;
    expect(isOccupied({ x: limit - 0.01, y: 0 }, 5, [disc('a', 0, 0)])).toBe(true);
    expect(isOccupied({ x: limit, y: 0 }, 5, [disc('a', 0, 0)])).toBe(false);
  });
  it('is false with nothing around', () => {
    expect(isOccupied({ x: 0, y: 0 }, 5, [])).toBe(false);
  });
});

describe('canPlantAt', () => {
  const bed = rectOutline(48, 24);
  it('needs the center inside the bed, edges included', () => {
    expect(canPlantAt({ x: 0, y: 0 }, 5, bed, [])).toBe(true);
    expect(canPlantAt({ x: 48, y: 24 }, 5, bed, [])).toBe(true);
    expect(canPlantAt({ x: 48.01, y: 10 }, 5, bed, [])).toBe(false);
  });
  it('refuses a spot on another plant', () => {
    expect(canPlantAt({ x: 5, y: 5 }, 5, bed, [disc('a', 6, 5)])).toBe(false);
  });
});

describe('snapToGrid', () => {
  it('lands on the grid through the anchor', () => {
    expect(snapToGrid({ x: 17, y: 4 }, { x: 10, y: 0 }, 6)).toEqual({ x: 16, y: 6 });
    expect(snapToGrid({ x: 9, y: -2 }, { x: 10, y: 0 }, 6)).toEqual({ x: 10, y: 0 });
  });
  it('rounds a halfway point away from the anchor on the positive side', () => {
    expect(snapToGrid({ x: 13, y: 0 }, { x: 10, y: 0 }, 6).x).toBe(16);
  });
});

describe('brushSpots', () => {
  it('lists the nodes along a straight stroke once each, in order', () => {
    const spots = brushSpots({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 }, 10);
    expect(spots.map((s) => s.x)).toEqual([0, 10, 20, 30]);
    expect(spots.every((s) => s.y === 0)).toBe(true);
  });
  it('leaves no gap in a fast diagonal sweep', () => {
    const spots = brushSpots({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 40, y: 40 }, 10);
    expect(spots).toContainEqual({ x: 20, y: 20 });
    for (let i = 1; i < spots.length; i++) expect(Math.hypot(spots[i].x - spots[i - 1].x, spots[i].y - spots[i - 1].y)).toBeLessThanOrEqual(10 * Math.SQRT2 + 1e-9);
  });
  it('is just the snapped end for a stroke that goes nowhere', () => {
    expect(brushSpots({ x: 0, y: 0 }, { x: 4, y: 4 }, { x: 4, y: 4 }, 10)).toEqual([{ x: 0, y: 0 }]);
  });
});

describe('hitPlant', () => {
  const discs = [disc('a', 0, 0, 10), disc('b', 5, 0, 10)];
  it('picks the topmost (last) plant under the point', () => {
    expect(hitPlant(discs, { x: 3, y: 0 }, 7)?.id).toBe('b');
  });
  it('needs the point inside 90% of the radius', () => {
    expect(hitPlant([disc('a', 0, 0, 10)], { x: 8.9, y: 0 }, 7)?.id).toBe('a');
    expect(hitPlant([disc('a', 0, 0, 10)], { x: 9.1, y: 0 }, 7)).toBeNull();
  });
  it('gives a tiny plant a 6 px target at any zoom', () => {
    expect(hitPlant([disc('a', 0, 0, 1)], { x: 0.8, y: 0 }, 10)?.id).toBe('a'); // 6px / 10 = 0.6in... 0.8 > 0.6
  });
  it('grabs a patch by the ground between its plants, but not a lone plant', () => {
    const patch = [disc('a', 0, 0, 3, 'g'), disc('b', 10, 0, 3, 'g')];
    expect(hitPlant(patch, { x: 5, y: 0 }, 7)?.groupId).toBe('g');
    expect(hitPlant([disc('s', 0, 0, 3)], { x: 5, y: 0 }, 7)).toBeNull();
    expect(hitPlant(patch, { x: 5, y: 20 }, 7)).toBeNull();
  });
});

describe('selectOnPress', () => {
  const discs = [disc('a', 0, 0, 5, 'g'), disc('b', 10, 0, 5, 'g'), disc('c', 40, 0, 5, 'c')];
  const none = { toggle: false, shift: false };
  it('selects the whole patch on a plain press', () => {
    expect(selectOnPress(discs, discs[0], [], none)).toEqual({ selection: ['a', 'b'], drill: null });
  });
  it('on a second press in the selected patch, keeps the patch for a drag but drills to one plant on release', () => {
    expect(selectOnPress(discs, discs[1], ['a', 'b'], none)).toEqual({ selection: ['a', 'b'], drill: 'b' });
  });
  it('does not drill into a lone plant', () => {
    expect(selectOnPress(discs, discs[2], ['c'], none)).toEqual({ selection: ['c'], drill: null });
  });
  it('replaces the selection when pressing a plant outside it', () => {
    expect(selectOnPress(discs, discs[2], ['a', 'b'], none).selection).toEqual(['c']);
  });
  it('toggles one plant with ⌘/Ctrl, on and off', () => {
    expect(selectOnPress(discs, discs[0], ['c'], { toggle: true, shift: false }).selection).toEqual(['c', 'a']);
    expect(selectOnPress(discs, discs[0], ['a', 'c'], { toggle: true, shift: false }).selection).toEqual(['c']);
  });
  it('toggles a whole patch with shift, on and off', () => {
    expect(selectOnPress(discs, discs[0], ['c'], { toggle: false, shift: true }).selection).toEqual(['c', 'a', 'b']);
    expect(selectOnPress(discs, discs[1], ['a', 'b', 'c'], { toggle: false, shift: true }).selection).toEqual(['c']);
  });
});

describe('marqueeSelect', () => {
  const discs = [disc('a', 0, 0), disc('b', 10, 10), disc('c', 20, 20)];
  it('takes centers inside the rectangle, edges included, whichever corner it was dragged from', () => {
    expect(marqueeSelect(discs, { x: 10, y: 10 }, { x: 0, y: 0 })).toEqual(['a', 'b']);
    expect(marqueeSelect(discs, { x: 0.1, y: 0.1 }, { x: 9.9, y: 9.9 })).toEqual([]);
  });
  it('adds to a base selection without repeating', () => {
    expect(marqueeSelect(discs, { x: 0, y: 0 }, { x: 10, y: 10 }, ['b', 'c'])).toEqual(['b', 'c', 'a']);
  });
});

describe('stamps', () => {
  const plants = [
    { cropId: 'kale', x: 10, y: 10, groupId: 'g' },
    { cropId: 'kale', x: 30, y: 10, groupId: 'g' },
  ];
  it('records plants relative to their middle and places them around a point', () => {
    const stamp = stampOf(plants);
    expect(stamp.map((s) => [s.dx, s.dy])).toEqual([[-10, 0], [10, 0]]);
    expect(stampSpots(stamp, { x: 100, y: 50 }).map((s) => [s.x, s.y])).toEqual([[90, 50], [110, 50]]);
    expect(stamp.every((s) => s.group === 'g')).toBe(true);
  });
  it('is empty for no plants', () => {
    expect(stampOf([])).toEqual([]);
  });
});

describe('centroid and extent', () => {
  it('averages points', () => {
    expect(centroid([{ x: 0, y: 0 }, { x: 10, y: 20 }])).toEqual({ x: 5, y: 10 });
  });
  it('wraps the rings of plants, and is null for none', () => {
    expect(extent([disc('a', 0, 0, 2), disc('b', 10, 4, 3)])).toEqual({ x0: -2, y0: -2, x1: 13, y1: 7 });
    expect(extent([])).toBeNull();
  });
});
