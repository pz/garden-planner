import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { gridPoints, isInsideOutline } from '../core/geometry';
import { asBlock, blockBox, blockPlantCount, blockPoints, latticeAnchors, LATTICE_IN, type Block } from './block';

const plantsOf = (cropId: string, pts: { x: number; y: number }[], groupId = 'g', bedId = 'bed'): PlantInstance[] =>
  pts.map((p, i) => ({ id: `${groupId}${i}`, bedId, cropId, x: p.x, y: p.y, groupId }));

describe('blockPoints / blockBox', () => {
  const block: Block = { bedId: 'b', cropId: 'lettuce', origin: { x: 5, y: 7 }, axis: 'x', columns: 3, rows: 2, source: 'new' };
  it('lays out a grid at the crop spacing (lettuce: 10 in)', () => {
    expect(blockPoints(block)).toEqual(gridPoints({ x: 5, y: 7 }, 'x', 3, 2, 10));
    expect(blockPlantCount(block)).toBe(6);
  });
  it('boxes the plant centers', () => {
    expect(blockBox(block)).toEqual({ x0: 5, y0: 7, x1: 25, y1: 17 });
  });
  it('swaps width and height on axis y', () => {
    expect(blockBox({ ...block, axis: 'y' })).toEqual({ x0: 5, y0: 7, x1: 15, y1: 27 });
    const pts = blockPoints({ ...block, axis: 'y' });
    expect(Math.max(...pts.map((p) => p.x))).toBe(15);
    expect(Math.max(...pts.map((p) => p.y))).toBe(27);
  });
});

describe('latticeAnchors', () => {
  it('covers a rect including its edges and far corner when the size is a multiple of the step', () => {
    const a = latticeAnchors({ shape: 'rect', widthIn: 24, heightIn: 12, cornerRadiusIn: 0 });
    expect(a).toContainEqual({ x: 0, y: 0 });
    expect(a).toContainEqual({ x: 24, y: 12 });
    expect(a).toHaveLength((24 / LATTICE_IN + 1) * (12 / LATTICE_IN + 1));
  });
  it('stops at the last step inside a bed whose size is not a multiple', () => {
    const xs = latticeAnchors({ shape: 'rect', widthIn: 10, heightIn: 3, cornerRadiusIn: 0 }).map((p) => p.x);
    expect(Math.max(...xs)).toBe(9);
  });
  it('keeps only anchors inside an ellipse and a rounded rect', () => {
    const ellipse = { shape: 'ellipse' as const, widthIn: 48, heightIn: 48 };
    const pts = latticeAnchors(ellipse);
    expect(pts.length).toBeGreaterThan(100);
    expect(pts.every((p) => isInsideOutline(p, ellipse))).toBe(true);
    expect(pts).not.toContainEqual({ x: 0, y: 0 });
    const rounded = { shape: 'rect' as const, widthIn: 48, heightIn: 48, cornerRadiusIn: 16 };
    expect(latticeAnchors(rounded)).not.toContainEqual({ x: 0, y: 0 });
    expect(latticeAnchors(rounded)).toContainEqual({ x: 0, y: 24 });
  });
});

describe('asBlock', () => {
  const grid = (cropId: string, cols: number, rows: number, s: number) => plantsOf(cropId, gridPoints({ x: 6, y: 9 }, 'x', cols, rows, s));
  it('recognises a full grid at the crop spacing', () => {
    expect(asBlock(grid('lettuce', 3, 2, 10))).toEqual({ bedId: 'bed', cropId: 'lettuce', origin: { x: 6, y: 9 }, axis: 'x', columns: 3, rows: 2, source: { groupId: 'g' } });
  });
  it('recognises a solo plant, a single row and a single column', () => {
    expect(asBlock(grid('tomato', 1, 1, 24))).toMatchObject({ columns: 1, rows: 1 });
    expect(asBlock(grid('tomato', 3, 1, 24))).toMatchObject({ columns: 3, rows: 1 });
    expect(asBlock(grid('tomato', 1, 3, 24))).toMatchObject({ columns: 1, rows: 3 });
  });
  it('is not fooled by plant order', () => {
    expect(asBlock(grid('lettuce', 3, 2, 10).reverse())).toMatchObject({ origin: { x: 6, y: 9 }, columns: 3, rows: 2 });
  });
  it('accepts rounding noise up to 0.01 in, not beyond', () => {
    const noisy = (e: number) => grid('lettuce', 3, 2, 10).map((p, i) => ({ ...p, x: p.x + (i % 2 ? e : 0) }));
    expect(asBlock(noisy(0.01))).not.toBeNull();
    expect(asBlock(noisy(0.02))).toBeNull();
  });
  it('rejects a grid at the wrong spacing, an L, a gap and doubled plants', () => {
    expect(asBlock(grid('lettuce', 3, 2, 12))).toBeNull();
    expect(asBlock(grid('lettuce', 3, 2, 10).slice(0, 5))).toBeNull(); // the last cell is empty
    expect(asBlock(grid('lettuce', 3, 3, 10).filter((_, i) => i !== 4))).toBeNull(); // a hole in the middle
    expect(asBlock([...grid('lettuce', 2, 1, 10), ...plantsOf('lettuce', [{ x: 6, y: 9 }], 'g', 'bed').map((p) => ({ ...p, id: 'dup' }))])).toBeNull();
    expect(asBlock(plantsOf('lettuce', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]))).toBeNull(); // an L
    expect(asBlock(plantsOf('lettuce', [{ x: 0, y: 0 }, { x: 20, y: 0 }]))).toBeNull(); // a gap
  });
  it('rejects empty and mixed patches', () => {
    expect(asBlock([])).toBeNull();
    const mixed = grid('lettuce', 2, 1, 10);
    mixed[1] = { ...mixed[1], cropId: 'kale' };
    expect(asBlock(mixed)).toBeNull();
    const twoBeds = grid('lettuce', 2, 1, 10);
    twoBeds[1] = { ...twoBeds[1], bedId: 'other' };
    expect(asBlock(twoBeds)).toBeNull();
  });
});
