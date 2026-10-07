import { describe, expect, it } from 'vitest';
import type { Bed, GardenPlan, PlantInstance } from '../types';
import { createPlan } from '../core/reducer';
import { MAX_GRID_CELLS, readLayout, type BedLayout } from './layoutView';

const bed = (over: Partial<Bed> = {}): Bed => ({ id: 'b1', name: 'Bed', shape: 'rect', cx: 12, cy: 6, widthIn: 24, heightIn: 12, rotationDeg: 0, ...over });
const plant = (id: string, cropId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance => ({ id, bedId: 'b1', cropId, x, y, groupId: id, ...over });
const planOf = (beds: Bed[], plants: PlantInstance[] = []): GardenPlan => ({ ...createPlan('g'), beds, plants });

function layoutOf(plan: GardenPlan, options?: Parameters<typeof readLayout>[1]): BedLayout[] {
  const r = readLayout(plan, options);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.layout.beds;
}

describe('readLayout grid', () => {
  it('is all free for an empty bed, one string per row, one char per cell', () => {
    const [b] = layoutOf(planOf([bed()]));
    expect(b.grid).toMatchObject({ cellIn: 6, columns: 4, rows: 2, lines: ['....', '....'], legend: {} });
    expect(b.freeFraction).toBe(1);
    expect(b.plantCount).toBe(0);
  });

  it('marks the cell holding a plant center with a capital, and cells in its growing room in lowercase', () => {
    // Kale needs 18 in, so its growing room is a circle of radius 9 around (3, 3), in cell (0,0).
    // Cell middles: (9,3) is 6 away and (3,9) is 6 away: covered; (9,9) is 8.5 away: covered; (15,3) is 12 away: not.
    const [b] = layoutOf(planOf([bed()], [plant('k', 'kale', 3, 3)]));
    expect(b.grid.lines).toEqual(['Kk..', 'kk..']);
    expect(b.grid.legend).toEqual({ K: 'kale' });
  });

  it('puts a plant exactly on the far edge in the last cell, not off the grid', () => {
    const [b] = layoutOf(planOf([bed()], [plant('t', 'basil', 24, 12)]));
    expect(b.grid.lines[1][3]).toBe('B');
  });

  it("draws the bed's shape: cells whose middle is outside it are #", () => {
    const [b] = layoutOf(planOf([bed({ shape: 'ellipse', widthIn: 24, heightIn: 24 })]), { cellIn: 6 });
    expect(b.grid.lines).toEqual(['#..#', '....', '....', '#..#']);
    expect(b.freeFraction).toBe(1); // free share is of the cells inside the shape
  });

  it('rounds a bed that is not a whole number of cells up, with partial cells at the edge', () => {
    const [b] = layoutOf(planOf([bed({ widthIn: 25, heightIn: 13 })]));
    expect(b.grid).toMatchObject({ columns: 5, rows: 3 });
    expect(b.grid.lines.every((l) => l.length === 5)).toBe(true);
  });

  it('reports the free share as the fraction of in-shape cells that are still free', () => {
    const [b] = layoutOf(planOf([bed()], [plant('a', 'basil', 3, 3), plant('b', 'basil', 21, 9)]));
    expect(b.freeFraction).toBeCloseTo(6 / 8, 9);
  });

  it('gives crops whose names start alike different letters, the same in every bed', () => {
    const plan = planOf([bed(), bed({ id: 'b2', name: 'Two' })], [plant('a', 'beans', 3, 3), plant('b', 'basil', 15, 3), plant('c', 'basil', 3, 3, { bedId: 'b2' })]);
    const [one, two] = layoutOf(plan);
    expect(one.grid.legend).toEqual({ B: 'basil', E: 'beans' }); // basil sorts first and takes B; beans takes the next letter of its name
    expect(two.grid.legend).toEqual({ B: 'basil' });
  });

  it('only counts plants in that bed', () => {
    const [one, two] = layoutOf(planOf([bed(), bed({ id: 'b2' })], [plant('a', 'basil', 3, 3), plant('z', 'basil', 9, 3, { bedId: 'b2' })]));
    expect([one.plantCount, two.plantCount]).toEqual([1, 1]);
    expect(one.grid.lines[0][0]).toBe('B');
    expect(one.grid.lines[0][1]).not.toBe('B');
  });
});

describe('readLayout summaries and options', () => {
  it('summarizes each patch with its crop, size and bounds', () => {
    const [b] = layoutOf(planOf([bed()], [plant('c1', 'carrot', 3, 3, { groupId: 'row' }), plant('c2', 'carrot', 9, 6, { groupId: 'row' }), plant('k', 'kale', 20, 9)]));
    expect(b.patches).toEqual([
      { groupId: 'row', cropId: 'carrot', count: 2, bounds: { x0: 3, y0: 3, x1: 9, y1: 6 } },
      { groupId: 'k', cropId: 'kale', count: 1, bounds: { x0: 20, y0: 9, x1: 20, y1: 9 } },
    ]);
  });

  it("passes the bed's place in the garden through", () => {
    const [b] = layoutOf(planOf([bed({ cx: 100, cy: 50, rotationDeg: 90 })]));
    expect(b).toMatchObject({ cx: 100, cy: 50, rotationDeg: 90, widthIn: 24, heightIn: 12, shape: 'rect' });
  });

  it('can be limited to one bed, and rejects an unknown one', () => {
    const plan = planOf([bed(), bed({ id: 'b2' })]);
    expect(layoutOf(plan, { bedId: 'b2' }).map((b) => b.id)).toEqual(['b2']);
    const r = readLayout(plan, { bedId: 'nope' });
    expect(r.ok === false && r.errors[0]).toMatchObject({ code: 'unknown_bed', path: '/bedId' });
  });

  it('honors cellIn and rejects non-positive or too-fine ones', () => {
    expect(layoutOf(planOf([bed()]), { cellIn: 12 })[0].grid).toMatchObject({ columns: 2, rows: 1 });
    for (const cellIn of [0, -3, NaN, Infinity]) expect(readLayout(planOf([bed()]), { cellIn }).ok).toBe(false);
    const huge = planOf([bed({ widthIn: 1000, heightIn: 1000 })]);
    const r = readLayout(huge, { cellIn: 1 });
    expect(r.ok).toBe(false);
    expect(MAX_GRID_CELLS).toBe(10_000);
    expect(readLayout(huge, { cellIn: 10 }).ok).toBe(true); // 100 × 100 = exactly the limit
  });
});
