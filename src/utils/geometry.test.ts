import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { computeGhosts, computeGroupBoxes, computeOrientedBox } from './geometry';

describe('computeOrientedBox', () => {
  it('boxes a single point as a square of its own diameter plus padding', () => {
    const box = computeOrientedBox([{ x: 10, y: 10, r: 5 }], 1);
    expect(box.centerX).toBeCloseTo(10);
    expect(box.centerY).toBeCloseTo(10);
    expect(box.width).toBeCloseTo(12); // 2*r + 2*pad
    expect(box.height).toBeCloseTo(12);
  });

  it('produces an axis-aligned box for points spread horizontally', () => {
    const points = [
      { x: 0, y: 0, r: 1 },
      { x: 10, y: 0, r: 1 },
    ];
    const box = computeOrientedBox(points, 0);
    expect(box.centerX).toBeCloseTo(5);
    expect(box.centerY).toBeCloseTo(0);
    expect(box.width).toBeCloseTo(12); // span 10 + 2*r
    expect(box.height).toBeCloseTo(2);
    // angle should be a multiple of 180deg (horizontal axis) modulo floating point noise
    expect(Math.abs(box.angleDeg) % 180).toBeCloseTo(0, 5);
  });

  it('rotates the box to follow a diagonal line of points', () => {
    const points = [
      { x: 0, y: 0, r: 1 },
      { x: 10, y: 10, r: 1 },
    ];
    const box = computeOrientedBox(points, 0);
    // A 45-degree diagonal line should produce a box rotated ~45 (or -135) degrees.
    const normalized = ((box.angleDeg % 180) + 180) % 180;
    expect(normalized).toBeCloseTo(45, 0);
    // The box should hug the line tightly along its long axis: length ~= diagonal + 2r.
    const diagonal = Math.sqrt(200);
    expect(Math.max(box.width, box.height)).toBeCloseTo(diagonal + 2, 0);
  });
});

function plant(id: string, cropId: string, x: number, y: number, groupId: string): PlantInstance {
  return { id, cropId, x, y, groupId };
}

describe('computeGroupBoxes', () => {
  it('produces no box for a lone plant (patch of one)', () => {
    const plants = [plant('a', 'carrot', 0, 0, 'g1')];
    expect(computeGroupBoxes(plants)).toEqual([]);
  });

  it('produces one box per group with two or more members', () => {
    const plants = [
      plant('a', 'carrot', 0, 0, 'g1'),
      plant('b', 'carrot', 3, 0, 'g1'),
      plant('c', 'lettuce', 50, 50, 'g2'), // lone plant, excluded
    ];
    const boxes = computeGroupBoxes(plants);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].groupId).toBe('g1');
    expect(boxes[0].cropId).toBe('carrot');
  });

  it('groups plants purely by groupId, independent of crop', () => {
    const plants = [plant('a', 'carrot', 0, 0, 'shared'), plant('b', 'lettuce', 3, 0, 'shared')];
    const boxes = computeGroupBoxes(plants);
    expect(boxes).toHaveLength(1);
    // cropId on the box comes from the first member encountered — a display detail,
    // not a semantic guarantee mixed-crop groups don't currently occur in the app.
    expect(boxes[0].cropId).toBe('carrot');
  });
});

describe('computeGhosts', () => {
  const bounds = { w: 96, h: 48 };

  it('returns no ghosts when the drag is shorter than the commit threshold', () => {
    const ghosts = computeGhosts({ x: 10, y: 10 }, { x: 12, y: 10 }, 24, bounds.w, bounds.h);
    expect(ghosts).toEqual([]);
  });

  it('places evenly-spaced ghosts along the drag direction', () => {
    const ghosts = computeGhosts({ x: 10, y: 20 }, { x: 82, y: 20 }, 24, bounds.w, bounds.h);
    // distance 72 / spacing 24 = exactly 3 steps
    expect(ghosts).toHaveLength(3);
    expect(ghosts[0]).toEqual({ x: 34, y: 20 });
    expect(ghosts[1]).toEqual({ x: 58, y: 20 });
    expect(ghosts[2]).toEqual({ x: 82, y: 20 });
  });

  it('omits ghosts that would fall outside the bed bounds', () => {
    const ghosts = computeGhosts({ x: 90, y: 20 }, { x: 200, y: 20 }, 24, bounds.w, bounds.h);
    // every step beyond x=90 immediately exceeds the 96-wide bed once the radius is added
    expect(ghosts).toEqual([]);
  });

  it('handles a purely vertical drag', () => {
    const ghosts = computeGhosts({ x: 10, y: 5 }, { x: 10, y: 40 }, 10, bounds.w, bounds.h);
    expect(ghosts.every((g) => g.x === 10)).toBe(true);
    expect(ghosts.length).toBeGreaterThan(0);
  });
});
