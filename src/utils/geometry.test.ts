import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { clampGroupDelta, computeGhosts, computeGroupBoxes, lockedAxis } from './geometry';

function plant(id: string, cropId: string, x: number, y: number, groupId: string): PlantInstance {
  return { id, cropId, x, y, groupId };
}

describe('computeGroupBoxes', () => {
  it('produces no box for a lone plant (patch of one)', () => {
    const plants = [plant('a', 'carrot', 0, 0, 'g1')];
    expect(computeGroupBoxes(plants)).toEqual([]);
  });

  it('produces one axis-aligned box per group with two or more members', () => {
    const plants = [
      plant('a', 'carrot', 0, 0, 'g1'),
      plant('b', 'carrot', 3, 0, 'g1'),
      plant('c', 'lettuce', 50, 50, 'g2'), // lone plant, excluded
    ];
    const boxes = computeGroupBoxes(plants);
    expect(boxes).toHaveLength(1);
    expect(boxes[0].groupId).toBe('g1');
    expect(boxes[0].cropId).toBe('carrot');
    // carrot spacing is 3in (r=1.5): span 0..3 plus radius on each end, plus padding.
    expect(boxes[0].left).toBeCloseTo(0 - 1.5 - 1.25);
    expect(boxes[0].width).toBeCloseTo(3 + 1.5 * 2 + 1.25 * 2);
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

describe('lockedAxis', () => {
  it('locks to horizontal when the drag is more horizontal than vertical', () => {
    expect(lockedAxis(10, 3)).toEqual({ x: 1, y: 0 });
  });

  it('locks to vertical when the drag is more vertical than horizontal', () => {
    expect(lockedAxis(3, 10)).toEqual({ x: 0, y: 1 });
  });

  it('never produces a diagonal axis, even for an exact 45-degree drag', () => {
    const axis = lockedAxis(10, 10);
    expect(axis.x === 0 || axis.y === 0).toBe(true);
  });
});

describe('computeGhosts', () => {
  const bounds = { w: 96, h: 48 };
  const horizontal = { x: 1, y: 0 };
  const vertical = { x: 0, y: 1 };

  it('places evenly-spaced ghosts along a horizontal axis', () => {
    const ghosts = computeGhosts({ x: 10, y: 20 }, horizontal, { x: 82, y: 20 }, 24, bounds.w, bounds.h);
    // distance 72 / spacing 24 = exactly 3 steps
    expect(ghosts).toHaveLength(3);
    expect(ghosts[0]).toEqual({ x: 34, y: 20 });
    expect(ghosts[1]).toEqual({ x: 58, y: 20 });
    expect(ghosts[2]).toEqual({ x: 82, y: 20 });
  });

  it('handles a purely vertical axis', () => {
    const ghosts = computeGhosts({ x: 10, y: 5 }, vertical, { x: 10, y: 40 }, 10, bounds.w, bounds.h);
    expect(ghosts.every((g) => g.x === 10)).toBe(true);
    expect(ghosts.length).toBeGreaterThan(0);
  });

  it('sweeps a rectangular grid when the cursor has both an along-axis and perpendicular offset', () => {
    // origin (10,10), locked horizontal axis, spacing 12: 2 columns (24/12) x 1 extra row (12/12).
    const grid = computeGhosts({ x: 10, y: 10 }, horizontal, { x: 34, y: 22 }, 12, bounds.w, bounds.h);
    expect(grid).toHaveLength(5); // a 3x2 grid minus the origin plant itself
    expect(grid).toEqual(
      expect.arrayContaining([
        { x: 22, y: 10 },
        { x: 34, y: 10 },
        { x: 10, y: 22 },
        { x: 22, y: 22 },
        { x: 34, y: 22 },
      ]),
    );
  });

  it('keeps a ghost whose center lands exactly on the bed edge, even though its spacing ring overflows', () => {
    // origin at x=88, spacing 8: steps land at 96 (== boundW, kept) then 104 (past it, dropped).
    const ghosts = computeGhosts({ x: 88, y: 20 }, horizontal, { x: 200, y: 20 }, 8, bounds.w, bounds.h);
    expect(ghosts).toEqual([{ x: 96, y: 20 }]);
  });

  it('omits a ghost once its center itself would leave the bed', () => {
    const ghosts = computeGhosts({ x: 90, y: 20 }, horizontal, { x: 200, y: 20 }, 24, bounds.w, bounds.h);
    // first step lands at x=114, already past the 96-wide bed
    expect(ghosts).toEqual([]);
  });
});

describe('clampGroupDelta', () => {
  const bounds = { w: 96, h: 48 };

  it('leaves the delta untouched when the whole group stays in bounds', () => {
    const members = [plant('a', 'tomato', 20, 20, 'g1'), plant('b', 'tomato', 40, 20, 'g1')];
    expect(clampGroupDelta(members, 5, 5, bounds.w, bounds.h)).toEqual({ x: 5, y: 5 });
  });

  it('clamps so every member keeps its center inside the bed, even though its spacing ring may not', () => {
    const members = [plant('a', 'tomato', 2, 20, 'g1')]; // near the left edge, spacing ring already overflows
    // a large negative dx would push the center past x=0; clamp to exactly 0.
    const { x } = clampGroupDelta(members, -10, 0, bounds.w, bounds.h);
    expect(x).toBeCloseTo(-2);
  });

  it('keeps the translation rigid by applying the same clamp to every member', () => {
    const members = [plant('a', 'tomato', 90, 20, 'g1'), plant('b', 'tomato', 94, 20, 'g1')];
    // pushing right would send 'b' past the 96-wide bed first; the whole delta clamps to that limit.
    const { x } = clampGroupDelta(members, 10, 0, bounds.w, bounds.h);
    expect(x).toBeCloseTo(2); // 94 + x <= 96
  });
});
