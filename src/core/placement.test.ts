import { describe, expect, it } from 'vitest';
import type { Bed, PlantInstance } from '../types';
import { bedAt, discsOf, gardenPosition, landingAt, planMove, planStamp, radiusOf } from './placement';

const bed = (id: string, over: Partial<Bed> = {}): Bed => ({ id, name: id, shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0, ...over });
const A = bed('a'); // garden x 0…96, y 0…48
const B = bed('b', { cx: 200, cy: 24, widthIn: 40, heightIn: 40 }); // x 180…220, y 4…44
const plant = (id: string, over: Partial<PlantInstance> = {}): PlantInstance => ({ id, bedId: 'a', cropId: 'carrot', x: 10, y: 10, groupId: id, ...over });

describe('radiusOf', () => {
  it('is half the crop spacing', () => {
    expect(radiusOf('carrot')).toBe(1.5);
    expect(radiusOf('tomato')).toBe(12);
  });
});

describe('gardenPosition and discsOf', () => {
  it('shifts a plant by its bed\'s place, and turns it with the bed', () => {
    expect(gardenPosition(A, { x: 10, y: 10 })).toEqual({ x: 10, y: 10 });
    const turned = bed('t', { cx: 100, cy: 100, widthIn: 40, heightIn: 20, rotationDeg: 90 });
    const g = gardenPosition(turned, { x: 20, y: 10 }); // the bed's center
    expect(g.x).toBeCloseTo(100);
    expect(g.y).toBeCloseTo(100);
    const corner = gardenPosition(turned, { x: 40, y: 10 }); // right edge midpoint → below the center after a quarter turn
    expect(corner.x).toBeCloseTo(100);
    expect(corner.y).toBeCloseTo(120);
  });
  it('lists plants in order with their rings, applies per-plant offsets, and skips plants with no bed', () => {
    const discs = discsOf([plant('p', { x: 5, y: 6 }), plant('q', { bedId: 'b', x: 20, y: 20 }), plant('lost', { bedId: 'zz' })], [A, B], (id) => (id === 'p' ? { x: 1, y: 2 } : undefined));
    expect(discs).toEqual([
      { id: 'p', x: 6, y: 8, r: 1.5, groupId: 'p' },
      { id: 'q', x: 200, y: 24, r: 1.5, groupId: 'q' },
    ]);
  });
});

describe('bedAt and landingAt', () => {
  it('finds the bed under a point, edges included, and the topmost where beds overlap', () => {
    expect(bedAt([A, B], { x: 96, y: 48 })?.id).toBe('a');
    expect(bedAt([A, B], { x: 96.1, y: 10 })).toBeNull();
    const over = bed('over', { cx: 60, cy: 24 });
    expect(bedAt([A, over], { x: 50, y: 24 })?.id).toBe('over');
  });
  it('prefers a given bed when the point is in it', () => {
    const over = bed('over', { cx: 60, cy: 24 });
    expect(landingAt([A, over], { x: 50, y: 24 }, 'a')?.bed.id).toBe('a');
    expect(landingAt([A, over], { x: 50, y: 24 })?.bed.id).toBe('over');
    expect(landingAt([A, B], { x: 200, y: 24 }, 'a')?.bed.id).toBe('b');
  });
  it('gives the point in the bed\'s own frame', () => {
    expect(landingAt([A, B], { x: 190, y: 14 })?.local).toEqual({ x: 10, y: 10 });
  });
});

describe('planMove', () => {
  const plants = [plant('p', { x: 90, y: 10 }), plant('q', { x: 20, y: 20 })];
  it('moves the chosen plants by the garden delta, in their own frames', () => {
    const r = planMove(plants, [A, B], ['q'], { x: 5, y: -3 });
    expect(r).toEqual({ moves: [{ id: 'q', bedId: 'a', x: 25, y: 17 }], outside: [] });
  });
  it('lets a plant cross into another bed', () => {
    const r = planMove(plants, [A, B], ['p'], { x: 100, y: 14 });
    expect(r.moves).toEqual([{ id: 'p', bedId: 'b', x: 10, y: 20 }]);
  });
  it('lists plants that would end up in no bed', () => {
    const r = planMove(plants, [A, B], ['p', 'q'], { x: 7, y: 0 }); // p → x 97, just outside
    expect(r.outside).toEqual(['p']);
    expect(r.moves.map((m) => m.id)).toEqual(['q']);
  });
  it('accepts a landing exactly on the edge', () => {
    expect(planMove(plants, [A], ['p'], { x: 6, y: 0 }).outside).toEqual([]);
  });
});

describe('planStamp', () => {
  const stamp = [
    { cropId: 'carrot', dx: -10, dy: 0, group: 'g' },
    { cropId: 'carrot', dx: 10, dy: 0, group: 'g' },
  ];
  it('puts each item at the point plus its offset, in the bed there', () => {
    const r = planStamp(stamp, [A, B], { x: 50, y: 20 });
    expect(r.map((p) => [p.bedId, p.x, p.y])).toEqual([['a', 40, 20], ['a', 60, 20]]);
  });
  it('leaves out items that land in no bed', () => {
    const r = planStamp(stamp, [A, B], { x: 4, y: 20 });
    expect(r.map((p) => p.x)).toEqual([4 + 10]);
  });
  it('is empty when nothing lands in a bed', () => {
    expect(planStamp(stamp, [A], { x: 500, y: 500 })).toEqual([]);
  });
});
