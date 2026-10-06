import { describe, expect, it } from 'vitest';
import type { Bed } from '../types';
import {
  bedPolygon,
  bedsOverlap,
  constrainMove,
  constrainResize,
  findFreeOffset,
  findOverlaps,
  introducesOverlap,
  overlappingIds,
  polygonsOverlap,
} from './overlap';

/** A rectangle bed with its top-left at (x, y). */
function rect(id: string, x: number, y: number, w = 48, h = 48, over: Partial<Bed> = {}): Bed {
  return { id, name: id, shape: 'rect', cx: x + w / 2, cy: y + h / 2, widthIn: w, heightIn: h, rotationDeg: 0, ...over };
}

describe('bedsOverlap', () => {
  it('is false for beds apart', () => {
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 100, 0))).toBe(false);
  });

  it('allows beds flush edge to edge, a partial edge, or corner to corner', () => {
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 48, 0))).toBe(false);
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 48, 20))).toBe(false);
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 0, 48))).toBe(false);
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 48, 48))).toBe(false);
  });

  it('is true by even an inch, or less', () => {
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 47, 0))).toBe(true);
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 47.99, 0))).toBe(true);
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 0, 47))).toBe(true);
  });

  it('is true when one bed sits inside another, or they are identical', () => {
    expect(bedsOverlap(rect('a', 0, 0, 96, 96), rect('b', 20, 20, 12, 12))).toBe(true);
    expect(bedsOverlap(rect('a', 0, 0), rect('b', 0, 0))).toBe(true);
  });

  it('is true for a cross shape where no corner of either is inside the other', () => {
    expect(bedsOverlap(rect('wide', 0, 20, 100, 12), rect('tall', 44, 0, 12, 60))).toBe(true);
  });

  it('is symmetric', () => {
    const a = rect('a', 0, 0);
    const b = rect('b', 40, 10, 30, 30);
    expect(bedsOverlap(a, b)).toBe(bedsOverlap(b, a));
  });

  describe('turned beds', () => {
    it('lets a square turned 45° touch a neighbor at a single corner, but not poke into it', () => {
      const diamond = rect('d', 0, 0, 48, 48, { rotationDeg: 45, cx: 100, cy: 24 });
      const reach = (48 * Math.SQRT2) / 2; // the diamond's half-width
      const touching = rect('n', 100 + reach, 0, 48, 48);
      expect(bedsOverlap(diamond, touching)).toBe(false);
      expect(bedsOverlap(diamond, { ...touching, cx: touching.cx - 1 })).toBe(true);
    });

    it('is not fooled by float noise when a turned bed sits flush against another', () => {
      const turned = rect('t', 0, 0, 48, 48, { rotationDeg: 90, cx: 24, cy: 24 });
      expect(bedsOverlap(turned, rect('n', 48, 0))).toBe(false);
      expect(bedsOverlap(rect('n', 48, 0), turned)).toBe(false);
    });
  });

  describe('ellipses', () => {
    const ellipse = (id: string, x: number, y: number, w: number, h: number): Bed => rect(id, x, y, w, h, { shape: 'ellipse' });

    it('lets a rectangle sit in the empty corner of an ellipse’s bounding box', () => {
      expect(bedsOverlap(ellipse('e', 0, 0, 96, 96), rect('r', 0, 0, 10, 10))).toBe(false);
    });

    it('is true once the rectangle reaches the curve', () => {
      expect(bedsOverlap(ellipse('e', 0, 0, 96, 96), rect('r', 0, 0, 30, 30))).toBe(true);
    });

    it('lets an ellipse touch a rectangle’s edge at its end, and rejects two overlapping ellipses', () => {
      expect(bedsOverlap(ellipse('e', 0, 0, 96, 48), rect('r', 96, 0))).toBe(false);
      expect(bedsOverlap(ellipse('e', 0, 0, 96, 48), ellipse('f', 80, 0, 96, 48))).toBe(true);
    });
  });

  describe('polygons', () => {
    // An L: the 48×48 box minus its top-left 24×24 quarter.
    const L = rect('L', 0, 0, 48, 48, {
      shape: 'polygon',
      points: [
        { x: 24, y: 0 },
        { x: 48, y: 0 },
        { x: 48, y: 48 },
        { x: 0, y: 48 },
        { x: 0, y: 24 },
        { x: 24, y: 24 },
      ],
    });

    it('lets a bed sit in the L’s notch, flush against it', () => {
      expect(bedsOverlap(L, rect('n', 0, 0, 24, 24))).toBe(false);
    });

    it('rejects a bed that pokes into the L', () => {
      expect(bedsOverlap(L, rect('n', 0, 0, 25, 24))).toBe(true);
      expect(bedsOverlap(L, rect('n', 0, 0, 24, 25))).toBe(true);
    });
  });
});

describe('polygonsOverlap', () => {
  it('works on bare polygons, whichever way round their corners run', () => {
    const cw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const ccw = [...cw].reverse();
    const other = [{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }, { x: 5, y: 15 }];
    expect(polygonsOverlap(cw, other)).toBe(true);
    expect(polygonsOverlap(ccw, other)).toBe(true);
    expect(polygonsOverlap(ccw, other.map((p) => ({ x: p.x + 10, y: p.y })))).toBe(false);
  });
});

describe('bedPolygon', () => {
  it('turns with the bed and moves with it', () => {
    const p = bedPolygon(rect('a', 100, 200, 40, 20, { rotationDeg: 90 }));
    // A 40×20 bed centered at (120, 210) and turned a quarter is 20 wide and 40 tall.
    const xs = p.map((q) => q.x);
    const ys = p.map((q) => q.y);
    expect(Math.min(...xs)).toBeCloseTo(110);
    expect(Math.max(...xs)).toBeCloseTo(130);
    expect(Math.min(...ys)).toBeCloseTo(190);
    expect(Math.max(...ys)).toBeCloseTo(230);
  });
});

describe('overlappingIds / findOverlaps', () => {
  const a = rect('a', 0, 0);
  const b = rect('b', 40, 0);
  const c = rect('c', 200, 0);
  const d = rect('d', 60, 10);
  it('lists the other beds a bed shares area with', () => {
    expect(overlappingIds(a, [a, b, c, d])).toEqual(['b']);
    expect(overlappingIds(b, [a, b, c, d]).sort()).toEqual(['a', 'd']);
  });
  it('lists each overlapping pair once', () => {
    expect(findOverlaps([a, b, c, d])).toEqual([
      ['a', 'b'],
      ['b', 'd'],
    ]);
    expect(findOverlaps([a, c])).toEqual([]);
    expect(findOverlaps([])).toEqual([]);
  });
});

describe('introducesOverlap', () => {
  const a = rect('a', 0, 0);
  const b = rect('b', 100, 0);
  it('flags adding a bed on top of another, and not one beside it', () => {
    expect(introducesOverlap([a, b], null, rect('n', 10, 10))).toBe(true);
    expect(introducesOverlap([a, b], null, rect('n', 48, 0))).toBe(false);
  });
  it('flags moving into another bed, and not moving clear', () => {
    expect(introducesOverlap([a, b], a, { ...a, cx: a.cx + 60 })).toBe(true);
    expect(introducesOverlap([a, b], a, { ...a, cy: a.cy + 60 })).toBe(false);
  });
  it('lets a bed that already overlaps be moved, as long as it meets nothing new', () => {
    const stuck = rect('s', 20, 0);
    expect(introducesOverlap([a, b, stuck], stuck, { ...stuck, cx: stuck.cx - 5 })).toBe(false); // still on a
    expect(introducesOverlap([a, b, stuck], stuck, { ...stuck, cx: stuck.cx + 60 })).toBe(true); // now also on b
    expect(introducesOverlap([a, b, stuck], stuck, { ...stuck, cy: 500 })).toBe(false); // clear of both
  });
});

describe('constrainMove', () => {
  const a = rect('a', 0, 0);
  const wall = rect('w', 120, 0); // a neighbor to the right, with a 72″ gap
  const zero = { dx: 0, dy: 0 };
  it('passes a clear move through untouched', () => {
    expect(constrainMove([a, wall], a, { dx: 20, dy: 30 }, zero)).toEqual({ dx: 20, dy: 30 });
  });
  it('stops flush against the neighbor instead of entering it', () => {
    expect(constrainMove([a, wall], a, { dx: 100, dy: 0 }, zero)).toEqual({ dx: 72, dy: 0 });
  });
  it('slides along the neighbor when only one axis is blocked', () => {
    const last = { dx: 72, dy: 0 }; // already flush
    expect(constrainMove([a, wall], a, { dx: 90, dy: 30 }, last)).toEqual({ dx: 72, dy: 30 });
  });
  it('stays where it is if it is blocked in every direction it asked for', () => {
    const boxed = [a, rect('r', 48, 0), rect('d', 0, 48)];
    expect(constrainMove(boxed, a, { dx: 10, dy: 10 }, zero)).toEqual(zero);
  });
});

describe('constrainResize', () => {
  const a = rect('a', 0, 0, 96, 48);
  const wall = rect('w', 120, 0);
  const right = { sx: 1, sy: 0 } as const;
  it('passes a clear resize through', () => {
    expect(constrainResize([a, wall], a, right, { w: 110, h: 48 }, { w: 96, h: 48 })).toEqual({ w: 110, h: 48 });
  });
  it('stops growing at the neighbor’s edge', () => {
    expect(constrainResize([a, wall], a, right, { w: 200, h: 48 }, { w: 96, h: 48 })).toEqual({ w: 120, h: 48 });
  });
  it('lets the free axis keep going while the other is blocked', () => {
    const corner = { sx: 1, sy: 1 } as const;
    expect(constrainResize([a, wall], a, corner, { w: 200, h: 80 }, { w: 120, h: 48 })).toEqual({ w: 120, h: 80 });
  });
});

describe('findFreeOffset', () => {
  const a = rect('a', 0, 0);
  it('uses the preferred spot if it is clear', () => {
    expect(findFreeOffset({ ...a, id: 'copy' }, [a], { dx: 100, dy: 0 })).toEqual({ dx: 100, dy: 0 });
  });
  it('finds the nearest clear spot when the preferred one overlaps', () => {
    const base = { ...a, id: 'copy' };
    const offset = findFreeOffset(base, [a], { dx: 12, dy: 12 })!;
    const copy = { ...base, cx: a.cx + offset.dx, cy: a.cy + offset.dy };
    expect(bedsOverlap(a, copy)).toBe(false);
    // The nearest clear spots on the 12″ grid around (12, 12) are 36″ away along an axis.
    expect(Math.hypot(offset.dx - 12, offset.dy - 12)).toBeLessThanOrEqual(36 + 1e-9);
  });
  it('gives up when there is no room within reach', () => {
    const huge = rect('h', -1000, -1000, 3000, 3000);
    expect(findFreeOffset({ ...a, id: 'copy' }, [huge], { dx: 0, dy: 0 }, 12, 3)).toBeNull();
  });
});
