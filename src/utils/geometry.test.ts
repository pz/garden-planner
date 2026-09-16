import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import {
  clampGroupDelta,
  clampPan,
  clampZoom,
  clientToBedCoords,
  computeFitZoom,
  computeGhosts,
  computeGroupBoxes,
  contentPointAt,
  lockedAxis,
  panToAlign,
  MAX_ZOOM,
  MIN_ZOOM,
} from './geometry';

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

describe('clampZoom', () => {
  it('passes values already inside the range through unchanged', () => {
    expect(clampZoom(1)).toBe(1);
  });

  it('clamps to MIN_ZOOM/MAX_ZOOM at and past each boundary', () => {
    expect(clampZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    expect(clampZoom(MIN_ZOOM - 0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(clampZoom(MAX_ZOOM + 0.1)).toBe(MAX_ZOOM);
  });
});

describe('clampPan', () => {
  it('centers an axis where content exactly fits the viewport (no panning possible)', () => {
    const pan = clampPan({ x: 50, y: -30 }, { width: 200, height: 100 }, { width: 200, height: 100 });
    expect(pan).toEqual({ x: 0, y: 0 });
  });

  it('centers an axis where content is smaller than the viewport, ignoring the proposed pan', () => {
    const pan = clampPan({ x: 999, y: -999 }, { width: 200, height: 100 }, { width: 100, height: 40 });
    expect(pan).toEqual({ x: 50, y: 30 });
  });

  it('clamps so the viewport stays fully covered when content is larger, at both edges', () => {
    // content 300 wide in a 200-wide viewport: pan.x must stay within [-100, 0]. Height matches
    // exactly (content == viewport) so y is uninteresting here — always centers to 0.
    const viewport = { width: 200, height: 100 };
    const content = { width: 300, height: 100 };
    expect(clampPan({ x: 10, y: 0 }, viewport, content)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -150, y: 0 }, viewport, content)).toEqual({ x: -100, y: 0 });
    expect(clampPan({ x: -100, y: 0 }, viewport, content)).toEqual({ x: -100, y: 0 }); // exactly at the limit
  });
});

describe('contentPointAt / panToAlign', () => {
  it('round-trips: the pan that aligns a content point puts that same point back under the anchor', () => {
    const zoom = 1.5;
    const anchor = { x: 120, y: 80 };
    const contentPoint = { x: 40, y: 200 };
    const pan = panToAlign(contentPoint, anchor, zoom);
    expect(contentPointAt(anchor, pan, zoom)).toEqual(contentPoint);
  });

  it('at zoom 1 and zero pan, viewport-local and content coordinates are identical', () => {
    expect(contentPointAt({ x: 42, y: 7 }, { x: 0, y: 0 }, 1)).toEqual({ x: 42, y: 7 });
  });
});

describe('clientToBedCoords', () => {
  const pxPerInch = 7;
  const bounds = { w: 96, h: 48 };

  it('converts a viewport point to inches at zoom 1 with no pan', () => {
    const p = clientToBedCoords({ x: 70, y: 35 }, { x: 0, y: 0 }, 1, pxPerInch, bounds.w, bounds.h);
    expect(p).toEqual({ x: 10, y: 5 });
  });

  it('accounts for pan and zoom together', () => {
    // content point (10in, 10in) = (70px, 70px) unscaled; at zoom 2 and pan (-50,-50):
    // viewport-local = pan + zoom*contentPx = (-50 + 140, -50 + 140) = (90, 90).
    const p = clientToBedCoords({ x: 90, y: 90 }, { x: -50, y: -50 }, 2, pxPerInch, bounds.w, bounds.h);
    expect(p.x).toBeCloseTo(10);
    expect(p.y).toBeCloseTo(10);
  });

  it('clamps to the bed edge rather than returning an out-of-bounds coordinate', () => {
    const p = clientToBedCoords({ x: -500, y: 100000 }, { x: 0, y: 0 }, 1, pxPerInch, bounds.w, bounds.h);
    expect(p).toEqual({ x: 0, y: bounds.h });
  });
});

describe('computeFitZoom', () => {
  it('stays at 100% when content already fits the viewport', () => {
    expect(computeFitZoom({ width: 400, height: 400 }, { width: 300, height: 200 })).toBe(1);
  });

  it('shrinks to fit the more constraining axis, never exceeding 100%', () => {
    // width would allow 2x, height only 0.5x — the smaller (height) wins.
    expect(computeFitZoom({ width: 600, height: 100 }, { width: 300, height: 200 })).toBeCloseTo(0.5);
  });

  it('never zooms in past 100% even when content is much smaller than the viewport', () => {
    expect(computeFitZoom({ width: 2000, height: 2000 }, { width: 100, height: 100 })).toBe(1);
  });

  it('clamps the result to MIN_ZOOM for content far larger than the viewport', () => {
    expect(computeFitZoom({ width: 100, height: 100 }, { width: 10000, height: 10000 })).toBe(MIN_ZOOM);
  });
});
