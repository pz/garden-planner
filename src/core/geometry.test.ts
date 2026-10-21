import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import {
  clampGroupDelta,
  clampToBed,
  clampToOutline,
  gridPoints,
  isInsideBed,
  isInsideOutline,
  rectOutline,
  type Outline,
} from './geometry';

function plant(id: string, cropId: string, x: number, y: number, groupId: string): PlantInstance {
  return { id, bedId: 'b1', cropId, x, y, groupId };
}

describe('isInsideBed', () => {
  const [w, h, r] = [96, 48, 4];

  it('treats a square corner as outside a rounded bed, but inside a square one', () => {
    expect(isInsideBed({ x: 0, y: 0 }, w, h, r)).toBe(false);
    expect(isInsideBed({ x: w, y: h }, w, h, r)).toBe(false);
    expect(isInsideBed({ x: 0, y: 0 }, w, h)).toBe(true);
  });

  it('accepts a point exactly on the corner arc, and rejects one just past it', () => {
    const d = r / Math.SQRT2; // 45° along the top-left arc, centered at (r, r)
    expect(isInsideBed({ x: r - d, y: r - d }, w, h, r)).toBe(true);
    expect(isInsideBed({ x: r - d - 0.01, y: r - d - 0.01 }, w, h, r)).toBe(false);
  });

  it('accepts a point flush with a straight edge right where the arc begins', () => {
    expect(isInsideBed({ x: r, y: 0 }, w, h, r)).toBe(true);
    expect(isInsideBed({ x: 0, y: r }, w, h, r)).toBe(true);
    expect(isInsideBed({ x: w, y: h - r }, w, h, r)).toBe(true);
  });

  it('rejects a point past a straight edge', () => {
    expect(isInsideBed({ x: 48, y: -0.01 }, w, h, r)).toBe(false);
    expect(isInsideBed({ x: w + 0.01, y: 24 }, w, h, r)).toBe(false);
  });
});

describe('clampToBed', () => {
  const [w, h, r] = [96, 48, 4];

  it('leaves a point already inside the bed untouched', () => {
    expect(clampToBed({ x: 10, y: 10 }, w, h, r)).toEqual({ x: 10, y: 10 });
  });

  it('clamps to a straight edge outside the corner zones', () => {
    expect(clampToBed({ x: -5, y: 20 }, w, h, r)).toEqual({ x: 0, y: 20 });
    expect(clampToBed({ x: 50, y: h + 9 }, w, h, r)).toEqual({ x: 50, y: h });
  });

  it('pulls a point past a rounded corner radially onto its arc', () => {
    // Diagonally out from the top-right arc center (92, 4).
    const p = clampToBed({ x: 100, y: -4 }, w, h, r);
    expect(p.x).toBeCloseTo(92 + r / Math.SQRT2);
    expect(p.y).toBeCloseTo(4 - r / Math.SQRT2);
    expect(isInsideBed(p, w, h, r)).toBe(true);
  });

  it('leaves the square corner alone when there is no radius', () => {
    expect(clampToBed({ x: 100, y: -4 }, w, h)).toEqual({ x: w, y: 0 });
  });
});

describe('clampGroupDelta', () => {
  const bounds = { w: 96, h: 48 };

  it('leaves the delta untouched when the whole group stays in bounds', () => {
    const members = [plant('a', 'tomato', 20, 20, 'g1'), plant('b', 'tomato', 40, 20, 'g1')];
    expect(clampGroupDelta(members, 5, 5, rectOutline(bounds.w, bounds.h))).toEqual({ x: 5, y: 5 });
  });

  it('clamps so every member keeps its center inside the bed, even though its spacing ring may not', () => {
    const members = [plant('a', 'tomato', 2, 20, 'g1')]; // near the left edge, spacing ring already overflows
    // a large negative dx would push the center past x=0; clamp to exactly 0.
    const { x } = clampGroupDelta(members, -10, 0, rectOutline(bounds.w, bounds.h));
    expect(x).toBeCloseTo(-2);
  });

  it('keeps the translation rigid by applying the same clamp to every member', () => {
    const members = [plant('a', 'tomato', 90, 20, 'g1'), plant('b', 'tomato', 94, 20, 'g1')];
    // pushing right would send 'b' past the 96-wide bed first; the whole delta clamps to that limit.
    const { x } = clampGroupDelta(members, 10, 0, rectOutline(bounds.w, bounds.h));
    expect(x).toBeCloseTo(2); // 94 + x <= 96
  });

  it('keeps a lone plant dragged into a rounded corner on the arc, not in the square corner', () => {
    const members = [plant('a', 'tomato', 80, 10, 'g1')];
    const d = clampGroupDelta(members, 50, -50, rectOutline(bounds.w, bounds.h, 4));
    const moved = { x: 80 + d.x, y: 10 + d.y };
    expect(isInsideBed(moved, bounds.w, bounds.h, 4)).toBe(true);
    expect(moved.x).toBeCloseTo(92 + 4 / Math.SQRT2);
    expect(moved.y).toBeCloseTo(4 - 4 / Math.SQRT2);
  });

  it('slides a rigid patch into a corner until its nearest member meets the arc', () => {
    const members = [plant('a', 'carrot', 70, 10, 'g1'), plant('b', 'carrot', 80, 10, 'g1'), plant('c', 'carrot', 80, 20, 'g1')];
    const d = clampGroupDelta(members, 40, -40, rectOutline(bounds.w, bounds.h, 4));
    for (const m of members) expect(isInsideBed({ x: m.x + d.x, y: m.y + d.y }, bounds.w, bounds.h, 4)).toBe(true);
    // 'b' is the corner-most member; it ends up touching the arc (within float slack).
    expect(Math.hypot(80 + d.x - 92, 10 + d.y - 4)).toBeCloseTo(4, 4);
  });

  it('allows a move flush along a straight edge right up to where the arc begins', () => {
    const members = [plant('a', 'tomato', 50, 0, 'g1')];
    expect(clampGroupDelta(members, 42, 0, rectOutline(bounds.w, bounds.h, 4))).toEqual({ x: 42, y: 0 });
  });
});

describe('isInsideOutline / clampToOutline: ellipse', () => {
  // 96″ × 48″: semi-axes 48 and 24, centered at (48, 24).
  const ellipse: Outline = { shape: 'ellipse', widthIn: 96, heightIn: 48 };

  it('accepts the ends of both axes, exactly on the curve', () => {
    expect(isInsideOutline({ x: 0, y: 24 }, ellipse)).toBe(true);
    expect(isInsideOutline({ x: 96, y: 24 }, ellipse)).toBe(true);
    expect(isInsideOutline({ x: 48, y: 0 }, ellipse)).toBe(true);
  });

  it('rejects a point just past the curve, and the bounding box corners', () => {
    expect(isInsideOutline({ x: -0.01, y: 24 }, ellipse)).toBe(false);
    expect(isInsideOutline({ x: 48, y: 48.01 }, ellipse)).toBe(false);
    expect(isInsideOutline({ x: 0, y: 0 }, ellipse)).toBe(false);
    expect(isInsideOutline({ x: 96, y: 48 }, ellipse)).toBe(false);
  });

  it('pulls an outside point onto the curve along the line to the center', () => {
    const p = clampToOutline({ x: 120, y: 24 }, ellipse);
    expect(p.x).toBeCloseTo(96);
    expect(p.y).toBeCloseTo(24);
    const corner = clampToOutline({ x: 96, y: 0 }, ellipse);
    expect(isInsideOutline(corner, ellipse)).toBe(true);
  });

  it('leaves an inside point untouched', () => {
    expect(clampToOutline({ x: 30, y: 20 }, ellipse)).toEqual({ x: 30, y: 20 });
  });
});

describe('isInsideOutline / clampToOutline: polygon', () => {
  // An L: 48″ square with its top-right 24″ quarter cut out.
  const L: Outline = {
    shape: 'polygon',
    widthIn: 48,
    heightIn: 48,
    points: [
      { x: 0, y: 0 },
      { x: 24, y: 0 },
      { x: 24, y: 24 },
      { x: 48, y: 24 },
      { x: 48, y: 48 },
      { x: 0, y: 48 },
    ],
  };

  it('accepts points on its edges and corners', () => {
    expect(isInsideOutline({ x: 12, y: 0 }, L)).toBe(true);
    expect(isInsideOutline({ x: 24, y: 12 }, L)).toBe(true); // the inner, notch edge
    expect(isInsideOutline({ x: 24, y: 24 }, L)).toBe(true); // the reflex corner
    expect(isInsideOutline({ x: 48, y: 48 }, L)).toBe(true);
  });

  it('rejects the cut-out notch, even though it is inside the bounding box', () => {
    expect(isInsideOutline({ x: 36, y: 12 }, L)).toBe(false);
    expect(isInsideOutline({ x: 24.01, y: 12 }, L)).toBe(false);
  });

  it('accepts the interior on both arms of the L', () => {
    expect(isInsideOutline({ x: 12, y: 12 }, L)).toBe(true);
    expect(isInsideOutline({ x: 40, y: 40 }, L)).toBe(true);
  });

  it('clamps a point in the notch to the nearest edge', () => {
    expect(clampToOutline({ x: 30, y: 10 }, L)).toEqual({ x: 24, y: 10 });
    expect(clampToOutline({ x: 40, y: 20 }, L)).toEqual({ x: 40, y: 24 });
  });

  it('clamps a point beyond a corner to that corner', () => {
    expect(clampToOutline({ x: -5, y: -5 }, L)).toEqual({ x: 0, y: 0 });
  });
});

describe('outline-aware placement', () => {
  it('clampGroupDelta keeps a patch dragged into a polygon notch out of it', () => {
    const L: Outline = {
      shape: 'polygon',
      widthIn: 48,
      heightIn: 48,
      points: [
        { x: 0, y: 0 },
        { x: 24, y: 0 },
        { x: 24, y: 24 },
        { x: 48, y: 24 },
        { x: 48, y: 48 },
        { x: 0, y: 48 },
      ],
    };
    const members = [plant('a', 'carrot', 10, 10, 'g1'), plant('b', 'carrot', 14, 10, 'g1')];
    const d = clampGroupDelta(members, 30, 0, L);
    for (const m of members) expect(isInsideOutline({ x: m.x + d.x, y: m.y + d.y }, L)).toBe(true);
    // It stops at the notch's left wall or slides down onto its floor — never into the notch.
    const b = { x: 14 + d.x, y: 10 + d.y };
    expect(b.x <= 24 + 1e-6 || b.y >= 24 - 1e-6).toBe(true);
  });
});

describe('gridPoints', () => {
  it('is just the origin for a 1×1 grid', () => {
    expect(gridPoints({ x: 5, y: 7 }, 'x', 1, 1, 3)).toEqual([{ x: 5, y: 7 }]);
  });

  it('runs columns along x and rows downward, row by row, spacing apart', () => {
    expect(gridPoints({ x: 0, y: 0 }, 'x', 3, 2, 4)).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 8, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 4 },
      { x: 8, y: 4 },
    ]);
  });

  it('with axis y, columns run downward and rows step rightward', () => {
    expect(gridPoints({ x: 10, y: 10 }, 'y', 2, 2, 3)).toEqual([
      { x: 10, y: 10 },
      { x: 10, y: 13 },
      { x: 13, y: 10 },
      { x: 13, y: 13 },
    ]);
  });

  it('is empty when either count is zero', () => {
    expect(gridPoints({ x: 0, y: 0 }, 'x', 0, 3, 4)).toEqual([]);
    expect(gridPoints({ x: 0, y: 0 }, 'x', 3, 0, 4)).toEqual([]);
  });

  it('keeps neighbors exactly one spacing apart (no drift across a long row)', () => {
    const pts = gridPoints({ x: 0.1, y: 0 }, 'x', 50, 1, 3);
    for (let i = 1; i < pts.length; i++) expect(pts[i].x - pts[i - 1].x).toBeCloseTo(3, 9);
  });
});
