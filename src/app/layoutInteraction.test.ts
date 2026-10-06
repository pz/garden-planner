import { describe, expect, it } from 'vitest';
import {
  alignTargets,
  boxBetween,
  closesPolygon,
  detentNear,
  edgeLabels,
  formatLength,
  labelAnchor,
  labelOffset,
  magneticAngle,
  moveCorner,
  moveSnapped,
  outerRadiusPx,
  parseAngle,
  parseLength,
  rectFromCorners,
  resizeCursor,
  resizeFromPointer,
  resizeSnapped,
  rotationFromPointer,
  snapCoordinate,
  snapLength,
  snapShift,
  snapTo,
  stepAngle,
} from './layoutInteraction';
import { MIN_BED_SIDE_IN, bedBounds, bedToGarden } from '../core/layout';
import type { Bed } from '../types';

const L_POINTS = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 24 },
  { x: 48, y: 24 },
  { x: 48, y: 48 },
  { x: 0, y: 48 },
];

function bed(over: Partial<Bed> = {}): Bed {
  // 8′ × 4′ with its top-left at the garden origin.
  return { id: 'b1', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0, ...over };
}
function polyBed(over: Partial<Bed> = {}): Bed {
  return bed({ id: 'p', shape: 'polygon', cx: 24, cy: 24, widthIn: 48, heightIn: 48, points: L_POINTS, ...over });
}

describe('snapTo', () => {
  it('rounds to the nearest 6″ step, with the half-way point rounding up', () => {
    expect(snapTo(2.9)).toBe(0);
    expect(snapTo(3)).toBe(6);
    expect(snapTo(8.9)).toBe(6);
    expect(snapTo(9)).toBe(12);
  });

  it('never returns -0', () => {
    expect(Object.is(snapTo(-1), 0)).toBe(true);
  });
});

describe('rectFromCorners', () => {
  it('snaps both corners and works whichever way the drag went', () => {
    expect(rectFromCorners({ x: 25, y: 13 }, { x: 1, y: -1 })).toEqual({ cx: 12, cy: 6, widthIn: 24, heightIn: 12 });
  });

  it('accepts a rectangle exactly at the minimum side length', () => {
    expect(rectFromCorners({ x: 0, y: 0 }, { x: MIN_BED_SIDE_IN, y: MIN_BED_SIDE_IN })).not.toBeNull();
  });

  it('rejects one a snap step under the minimum on either side', () => {
    expect(rectFromCorners({ x: 0, y: 0 }, { x: MIN_BED_SIDE_IN - 6, y: 48 })).toBeNull();
    expect(rectFromCorners({ x: 0, y: 0 }, { x: 48, y: MIN_BED_SIDE_IN - 6 })).toBeNull();
  });

  it('rejects a click with no drag', () => {
    expect(rectFromCorners({ x: 30, y: 30 }, { x: 30, y: 30 })).toBeNull();
  });
});

describe('resizeFromPointer', () => {
  it('moves the dragged side by the inch between foot marks', () => {
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 110.4, y: 999 }).widthIn).toBe(110);
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 111.6, y: 999 }).widthIn).toBe(112);
  });

  it('sticks to a foot mark when the pointer is close, but not when it is not', () => {
    // At 7 px/in a foot mark pulls from 12px ≈ 1.7″ away.
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 109.6, y: 0 }).widthIn).toBe(108);
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 110, y: 0 }).widthIn).toBe(110);
  });

  it('pulls from the same screen distance at any zoom, and not at all when free', () => {
    const far = { x: 112, y: 0 }; // 4″ past the 108 mark
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, far, { zoom: 1 }).widthIn).toBe(108); // 8px = 8″ here
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, far, { zoom: 16 }).widthIn).toBe(112);
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 108.9, y: 0 }, { zoom: 7, free: true }).widthIn).toBe(109);
  });

  it('ignores the pointer along an axis the handle doesn’t move', () => {
    const next = resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 96, y: 500 });
    expect(next.heightIn).toBe(48);
    expect(next.cy).toBe(24);
  });

  it('stops at the minimum side instead of flipping when dragged past the far side', () => {
    const next = resizeFromPointer(bed(), { sx: -1, sy: 0 }, { x: 500, y: 24 });
    expect(next.widthIn).toBe(MIN_BED_SIDE_IN);
    expect(bedBounds(next).x1).toBe(96); // right edge still fixed
  });
});

describe('formatLength', () => {
  it('shows feet and inches, dropping whichever part is zero', () => {
    expect(formatLength(54)).toBe('4′ 6″');
    expect(formatLength(48)).toBe('4′');
    expect(formatLength(6)).toBe('6″');
    expect(formatLength(0)).toBe('0″');
  });

  it('rounds to the nearest inch, carrying into feet', () => {
    expect(formatLength(11.6)).toBe('1′');
  });
});

describe('parseLength', () => {
  it.each([
    ['4′ 6″', 54],
    ["4' 6\"", 54],
    ['4ft 6in', 54],
    ['4 ft', 48],
    ['4 6', 54],
    ['54in', 54],
    ['54″', 54],
    ['4', 48],
    ['2.5', 30],
    ['  8′  ', 96],
  ])('reads %j as %d″', (text, inches) => {
    expect(parseLength(text)).toBe(inches);
  });

  it.each(['', 'abc', '4′ 6″ 2', '-4', '0', "0' 0\"", '4m'])('rejects %j', (text) => {
    expect(parseLength(text)).toBeNull();
  });

  it('can read a bare number as inches', () => {
    expect(parseLength('3', { bareUnit: 'in' })).toBe(3);
    expect(parseLength('1′', { bareUnit: 'in' })).toBe(12);
  });

  it('accepts zero only when asked to', () => {
    expect(parseLength('0', { bareUnit: 'in', allowZero: true })).toBe(0);
    expect(parseLength("0' 0\"", { allowZero: true })).toBe(0);
    expect(parseLength('-1', { bareUnit: 'in', allowZero: true })).toBeNull();
  });
});

describe('boxBetween', () => {
  it('spans two points whichever way round they are', () => {
    expect(boxBetween({ x: 10, y: 2 }, { x: 4, y: 8 })).toEqual({ x: 4, y: 2, width: 6, height: 6 });
  });
});

describe('outerRadiusPx', () => {
  it('adds the border to the inner radius so the two curves are concentric', () => {
    expect(outerRadiusPx(4, 7, 2.5)).toBe(30.5);
  });
  it('keeps a square bed square', () => {
    expect(outerRadiusPx(0, 7, 2.5)).toBe(0);
  });
});

describe('moveCorner', () => {
  it('moves one corner, snapped, and leaves the others fixed in the garden', () => {
    const b = polyBed();
    const next = moveCorner(b, 2, { x: 37, y: 13 }); // the reflex corner (24, 24) → (36, 12)
    expect(next.points![2]).toEqual({ x: 36, y: 12 });
    for (const i of [0, 1, 3, 4, 5]) expect(bedToGarden(next, next.points![i])).toEqual(bedToGarden(b, b.points![i]));
  });

  it('re-fits the box when a corner moves past it', () => {
    const next = moveCorner(polyBed(), 0, { x: -12, y: -12 });
    expect(bedBounds(next)).toEqual({ x0: -12, y0: -12, x1: 48, y1: 48 });
    expect(next.points![0]).toEqual({ x: 0, y: 0 });
    expect(bedToGarden(next, next.points![4])).toEqual({ x: 48, y: 48 });
  });

  it('refuses a move that would collapse the shape', () => {
    const tri = polyBed({ widthIn: 48, heightIn: 48, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 0, y: 48 }] });
    expect(moveCorner(tri, 2, { x: 24, y: 0 })).toBe(tri); // all three on one line
    expect(moveCorner(tri, 5, { x: 0, y: 0 })).toBe(tri); // no such corner
  });
});

describe('closesPolygon', () => {
  const pts = [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }];

  it('closes within 14 screen pixels of the first corner, once there are three corners', () => {
    // At 2 px/in the target is 7″: (3, 4) is 5″ away, (6, 4) about 7.2″.
    expect(closesPolygon(pts, { x: 3, y: 4 }, 2)).toBe(true);
    expect(closesPolygon(pts, { x: 6, y: 4 }, 2)).toBe(false);
    expect(closesPolygon(pts.slice(0, 2), { x: 0, y: 0 }, 2)).toBe(false);
  });

  it('never needs a click closer than one snap step, however far zoomed in', () => {
    expect(closesPolygon(pts, { x: 6, y: 0 }, 16)).toBe(true);
    expect(closesPolygon(pts, { x: 6, y: 0.1 }, 16)).toBe(false);
  });
});

describe('edgeLabels', () => {
  it('measures each edge and points its normal away from the shape, either winding', () => {
    const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    for (const pts of [square, [...square].reverse()]) {
      const labels = edgeLabels(pts);
      expect(labels).toHaveLength(4);
      for (const l of labels) {
        expect(l.lengthIn).toBe(10);
        // Stepping out along the normal moves away from the square's center.
        const out = { x: l.mid.x + l.outward.x, y: l.mid.y + l.outward.y };
        expect(Math.hypot(out.x - 5, out.y - 5)).toBeGreaterThan(Math.hypot(l.mid.x - 5, l.mid.y - 5));
      }
    }
  });

  it('leaves out the closing edge of an open chain, and skips zero-length edges', () => {
    const chain = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }];
    expect(edgeLabels(chain, false).map((l) => l.lengthIn)).toEqual([10, 5]);
  });
});

describe('labelOffset', () => {
  it('clears a horizontal edge by half the label height, and a vertical one by half its width', () => {
    expect(labelOffset({ x: 0, y: -1 }, 20, 5, 2)).toBe(7);
    expect(labelOffset({ x: 1, y: 0 }, 20, 5, 2)).toBe(22);
  });
});

describe('rotationFromPointer', () => {
  const center = { cx: 0, cy: 0 };

  it('reads 0° with the handle straight above the center, 90° to its right', () => {
    expect(rotationFromPointer(center, { x: 0, y: -10 })).toBe(0);
    expect(rotationFromPointer(center, { x: 10, y: 0 })).toBe(90);
    expect(rotationFromPointer(center, { x: 0, y: 10 })).toBe(180);
    expect(rotationFromPointer(center, { x: -10, y: 0 })).toBe(270);
  });

  it('turns by the degree between marks', () => {
    // 20° from straight up: clear of the 15° mark's pull, so it is just 20°.
    const deg = 20;
    const r = (deg * Math.PI) / 180;
    expect(rotationFromPointer(center, { x: 10 * Math.sin(r), y: -10 * Math.cos(r) })).toBe(20);
  });

  it('sticks near 45° and 15° marks', () => {
    expect(rotationFromPointer(center, { x: 10, y: -9 })).toBe(45); // ≈ 48°
    expect(rotationFromPointer(center, { x: 3, y: -10 })).toBe(15); // ≈ 16.7°
  });

  it('can be turned freely', () => {
    expect(rotationFromPointer(center, { x: 10, y: -9 }, true)).toBe(48);
  });
});

describe('magneticAngle', () => {
  it.each([
    [44, 45],
    [39, 45], // exactly 6° away still sticks
    [38, 38],
    [16, 15],
    [17.4, 17],
    [-3, 0],
    [-9, 351],
    [372, 12],
    [361, 0],
    [359.6, 0],
  ])('%d° lands on %d°', (deg, expected) => {
    expect(magneticAngle(deg)).toBe(expected);
  });

  it('keeps a fraction of a degree out of the result and ignores marks when free', () => {
    expect(magneticAngle(44, true)).toBe(44);
    expect(magneticAngle(44.4, true)).toBe(44);
  });
});

describe('stepAngle', () => {
  it.each([
    [0, 1, 45],
    [0, -1, 315],
    [7, 1, 45],
    [7, -1, 0],
    [45, -1, 0],
    [44, 1, 45],
    [315, 1, 0],
  ] as const)('from %d° going %d lands on %d°', (deg, dir, expected) => {
    expect(stepAngle(deg, dir)).toBe(expected);
  });
});

describe('detentNear', () => {
  const d = [{ step: 12, tolerance: 1 }];
  it('is inclusive at the tolerance and null just past it', () => {
    expect(detentNear(25, d)).toBe(24);
    expect(detentNear(25.01, d)).toBeNull();
  });
  it('caps a tolerance wider than half a step so every value does not snap to two marks', () => {
    expect(detentNear(5, [{ step: 12, tolerance: 100 }])).toBe(0);
    expect(detentNear(7, [{ step: 12, tolerance: 100 }])).toBe(12);
  });
  it('prefers earlier detents', () => {
    expect(detentNear(12.5, [{ step: 12, tolerance: 1 }, { step: 6, tolerance: 1 }])).toBe(12);
  });
});

describe('snapLength', () => {
  it('goes by the inch between marks and sticks to foot and half-foot marks', () => {
    expect(snapLength(50.3)).toBe(50);
    expect(snapLength(47.2)).toBe(48);
    expect(snapLength(54.5)).toBe(54);
  });
  it('does not return -0', () => {
    expect(Object.is(snapLength(-0.2), 0)).toBe(true);
  });
});

describe('snapShift', () => {
  it('moves by the inch when no edge is near a mark', () => {
    expect(snapShift([103.5, 163.5], 20.4)).toBe(20);
  });
  it('shifts so an edge lands on a foot mark when it is close', () => {
    // Edge at 100 moved by 7.5 would be at 107.5; the 108 mark is within reach.
    expect(snapShift([100], 7.5)).toBe(8);
  });
  it('lets either edge catch a mark and the nearest nudge wins', () => {
    // Left edge 0 → 11.8 is 0.2 off the 12 mark; right edge 48.3 → 60.1 is 0.1 off 60: the right edge wins.
    expect(snapShift([0, 48.3], 11.8)).toBeCloseTo(11.7);
  });
  it('ignores marks when free', () => {
    expect(snapShift([100], 7.5, { zoom: 7, free: true })).toBe(8);
    expect(snapShift([100], 7.4, { zoom: 7, free: true })).toBe(7);
  });
});

describe('parseAngle', () => {
  it.each([
    ['90', 90],
    ['90°', 90],
    [' -45 deg ', -45],
    ['12.5 degrees', 12.5],
  ])('reads %j as %d', (text, deg) => {
    expect(parseAngle(text)).toBe(deg);
  });

  it.each(['', 'ninety', '90 rad', '9 0'])('rejects %j', (text) => {
    expect(parseAngle(text)).toBeNull();
  });
});

describe('resizeCursor', () => {
  it('matches the handle on an unturned bed', () => {
    expect(resizeCursor({ sx: 1, sy: 0 }, 0)).toBe('ew-resize');
    expect(resizeCursor({ sx: 0, sy: -1 }, 0)).toBe('ns-resize');
    expect(resizeCursor({ sx: 1, sy: 1 }, 0)).toBe('nwse-resize');
    expect(resizeCursor({ sx: 1, sy: -1 }, 0)).toBe('nesw-resize');
    expect(resizeCursor({ sx: -1, sy: -1 }, 0)).toBe('nwse-resize');
  });

  it('turns with the bed', () => {
    expect(resizeCursor({ sx: 1, sy: 0 }, 90)).toBe('ns-resize');
    expect(resizeCursor({ sx: 1, sy: 0 }, 45)).toBe('nwse-resize');
    expect(resizeCursor({ sx: 1, sy: 1 }, 45)).toBe('ns-resize');
  });
});

describe('snapCoordinate', () => {
  const snap = { zoom: 7 };
  it('lines up with a target when close, ahead of the grid', () => {
    // 100.5 is 0.5 from the target and 4.5 from the 96 mark.
    expect(snapCoordinate(100.5, [101], snap)).toEqual({ value: 101, guide: 101, kind: 'target' });
  });
  it('takes the nearest of several targets', () => {
    expect(snapCoordinate(50, [48.5, 51.2, 90], snap).value).toBe(51.2);
  });
  it('falls back to a foot mark, then to the inch', () => {
    expect(snapCoordinate(97.2, [200], snap)).toEqual({ value: 96, guide: 96, kind: 'grid' });
    expect(snapCoordinate(100.2, [200], snap)).toEqual({ value: 100, guide: null, kind: null });
  });
  it('is inclusive at the pull distance (14px for targets) and not beyond it', () => {
    expect(snapCoordinate(52, [50], snap).guide).toBe(50); // exactly 2″ = 14px at 7 px/in
    expect(snapCoordinate(52.01, [50], snap).guide).toBeNull();
  });
  it('does nothing but round when free', () => {
    expect(snapCoordinate(50.4, [50], { zoom: 7, free: true })).toEqual({ value: 50, guide: null, kind: null });
  });
});

describe('alignTargets', () => {
  it('collects the edges and centers of the beds, in garden coordinates', () => {
    const t = alignTargets([bed({ cx: 48, cy: 24 }), bed({ id: 'b', cx: 200, cy: 100, widthIn: 40, heightIn: 20 })]);
    expect(t.xs).toEqual([0, 48, 96, 180, 200, 220]);
    expect(t.ys).toEqual([0, 24, 48, 90, 100, 110]);
  });
});

describe('moveSnapped', () => {
  const none = { xs: [], ys: [] };
  it('slides a side of the bed onto another bed\'s edge when close, and reports a guide', () => {
    // The bed spans x 0…96; moving by 103 puts its right side at 199, 1″ short of a bed edge at 200.
    const r = moveSnapped(bed(), 103, 0.4, { xs: [200], ys: [] });
    expect(r.dx).toBe(104);
    expect(r.dy).toBe(0);
    expect(r.guides).toContainEqual({ axis: 'x', at: 200 });
  });
  it('lines the center up too', () => {
    const r = moveSnapped(bed(), 51.5, 0, { xs: [100], ys: [] }); // center 48 → 99.5, target 100
    expect(r.dx).toBe(52);
  });
  it('sticks to the visible 1 ft grid, and moves by the inch elsewhere', () => {
    const near = moveSnapped(bed(), 12.9, 30.5, none); // left side → 12.9 (the 12 mark is 0.9 away)
    expect(near.dx).toBe(12);
    expect(near.guides).toContainEqual({ axis: 'x', at: 12 });
  });
  it('adds no guide when nothing is in reach', () => {
    // Every edge and center of this bed ends up more than a pull's distance from a 6″ mark.
    const r = moveSnapped(bed({ widthIn: 97, heightIn: 49, cx: 48.5, cy: 24.5 }), 3, 3, none);
    expect(r).toEqual({ dx: 3, dy: 3, guides: [] });
  });
  it('does not snap at all when free', () => {
    const r = moveSnapped(bed(), 12.4, 0, { xs: [12], ys: [] }, { zoom: 7, free: true });
    expect(r).toEqual({ dx: 12, dy: 0, guides: [] });
  });
});

describe('resizeSnapped', () => {
  it('lines the moving edge up with another bed and reports a guide', () => {
    // Bed spans x 0…96. The pointer is 1″ short of another bed's edge at 140.
    const r = resizeSnapped(bed(), { sx: 1, sy: 0 }, { x: 139, y: 0 }, { xs: [140], ys: [] });
    expect(r.bed.widthIn).toBe(140);
    expect(r.guides).toEqual([{ axis: 'x', at: 140 }]);
  });
  it('measures from the fixed side when the left edge moves', () => {
    // Left edge dragged to x = -40 → width 136, aligned with a bed edge at -40.5.
    const r = resizeSnapped(bed(), { sx: -1, sy: 0 }, { x: -40.2, y: 24 }, { xs: [-40.5], ys: [] });
    expect(r.bed.widthIn).toBe(136.5);
    expect(bedBounds(r.bed).x0).toBe(-40.5);
    expect(r.guides).toEqual([{ axis: 'x', at: -40.5 }]);
  });
  it('aligns a vertical resize to the y targets', () => {
    const r = resizeSnapped(bed(), { sx: 0, sy: 1 }, { x: 10, y: 79.5 }, { xs: [], ys: [80] });
    expect(r.bed.heightIn).toBe(80);
    expect(r.guides).toEqual([{ axis: 'y', at: 80 }]);
  });
  it('works through a bed turned 90°', () => {
    // Turned a quarter, the bed\'s local right edge points down the garden.
    const b = bed({ rotationDeg: 90 });
    const bottom = bedBounds(b).y1;
    const r = resizeSnapped(b, { sx: 1, sy: 0 }, { x: b.cx, y: bottom + 39 }, { xs: [], ys: [bottom + 40] });
    expect(r.bed.widthIn).toBe(136);
    expect(r.guides).toEqual([{ axis: 'y', at: bottom + 40 }]);
  });
  it('only uses the size marks on a bed turned any other angle', () => {
    const b = bed({ rotationDeg: 45 });
    const r = resizeSnapped(b, { sx: 1, sy: 0 }, bedToGarden(b, { x: 109.6, y: 24 }), { xs: [1000], ys: [1000] });
    expect(r.bed.widthIn).toBe(108);
    expect(r.guides).toEqual([]);
  });
  it('still never shrinks below the minimum, even next to an aligned edge', () => {
    const r = resizeSnapped(bed(), { sx: 1, sy: 0 }, { x: 5, y: 0 }, { xs: [5], ys: [] });
    expect(r.bed.widthIn).toBe(MIN_BED_SIDE_IN);
    expect(r.guides).toEqual([]);
  });
  it('ignores targets when free', () => {
    const r = resizeSnapped(bed(), { sx: 1, sy: 0 }, { x: 139, y: 0 }, { xs: [140], ys: [] }, { zoom: 7, free: true });
    expect(r.bed.widthIn).toBe(139);
    expect(r.guides).toEqual([]);
  });
});

describe('labelAnchor', () => {
  it('starts at the left end of a flat top edge: the top-left corner of an unturned rectangle', () => {
    expect(labelAnchor(bed())).toEqual({ x: 0, y: 0, align: 'start' });
  });

  it('centers over the top corner of a rectangle turned 45°, not its far-off bounding box corner', () => {
    const a = labelAnchor(bed({ rotationDeg: 45 }));
    expect(a.align).toBe('middle');
    // The highest corner of a 96×48 box turned 45° is its top-left one.
    const topLeft = bedToGarden(bed({ rotationDeg: 45 }), { x: 0, y: 0 });
    expect(a.x).toBeCloseTo(topLeft.x);
    expect(a.y).toBeCloseTo(topLeft.y);
  });

  it('centers over the top of an ellipse', () => {
    const a = labelAnchor(bed({ shape: 'ellipse' }));
    expect(a.align).toBe('middle');
    expect(a.x).toBeCloseTo(48);
    expect(a.y).toBeCloseTo(0);
  });

  it('follows an ellipse that is turned a quarter, to its new highest point', () => {
    const a = labelAnchor(bed({ shape: 'ellipse', rotationDeg: 90 }));
    expect(a.align).toBe('middle');
    expect(a.x).toBeCloseTo(48);
    expect(a.y).toBeCloseTo(24 - 48); // the long axis now runs up and down: 48″ above the center
  });

  it('sits over the apex of a triangle', () => {
    const tri = polyBed({ widthIn: 48, heightIn: 48, cx: 24, cy: 24, points: [{ x: 24, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }] });
    expect(labelAnchor(tri)).toEqual({ x: 24, y: 0, align: 'middle' });
  });

  it('skips an empty top-left corner: an L-shape missing it is labeled over its actual top edge', () => {
    const l = polyBed({
      widthIn: 48,
      heightIn: 48,
      cx: 24,
      cy: 24,
      points: [{ x: 24, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }, { x: 0, y: 24 }, { x: 24, y: 24 }],
    });
    expect(labelAnchor(l)).toEqual({ x: 24, y: 0, align: 'start' });
  });

  it('picks the higher peak when a notch splits the top', () => {
    const u = polyBed({
      widthIn: 60,
      heightIn: 48,
      cx: 30,
      cy: 24,
      points: [{ x: 0, y: 6 }, { x: 12, y: 6 }, { x: 12, y: 24 }, { x: 36, y: 24 }, { x: 36, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 48 }, { x: 0, y: 48 }],
    });
    expect(labelAnchor(u)).toEqual({ x: 36, y: 0, align: 'start' });
  });

  it('works in garden coordinates for a bed that is not at the origin', () => {
    expect(labelAnchor(bed({ cx: 300, cy: 200 }))).toEqual({ x: 252, y: 176, align: 'start' });
  });
});