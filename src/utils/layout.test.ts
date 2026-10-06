import { describe, expect, it } from 'vitest';
import type { Bed, PlantInstance } from '../types';
import {
  BED_CORNER_RADIUS_IN,
  MAX_ZOOM,
  MIN_BED_SIDE_IN,
  MIN_ZOOM,
  bedBounds,
  bedOutline,
  boxCorners,
  cloneBed,
  copyName,
  normalizeAngle,
  parseAngle,
  resizeCursor,
  rotationFromPointer,
  snapAngle,
  closesPolygon,
  edgeLabels,
  geometryOf,
  moveCorner,
  polygonFromCorners,
  signedArea2,
  bedToGarden,
  boxBetween,
  drawnCornerRadius,
  gardenToScreen,
  normalizeCornerRadius,
  outerRadiusPx,
  isDrag,
  labelOffset,
  wheelZoomFactor,
  MAX_WHEEL_ZOOM_DELTA,
  fitView,
  formatLength,
  gardenBounds,
  gardenToBed,
  nextBedName,
  normalizeSide,
  plantSummary,
  panBy,
  parseLength,
  rectFromCorners,
  relocatePlants,
  resizeBedTo,
  resizeFromPointer,
  screenToGarden,
  snapTo,
  zoomAt,
  zoomPercent,
} from './layout';

function bed(over: Partial<Bed> = {}): Bed {
  // 8′ × 4′ with its top-left at the garden origin.
  return { id: 'b1', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0, ...over };
}

function plant(id: string, x: number, y: number, bedId = 'b1'): PlantInstance {
  return { id, bedId, cropId: 'tomato', x, y, groupId: id };
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

describe('bedToGarden / gardenToBed', () => {
  it('puts local (0, 0) at the bed’s top-left corner', () => {
    expect(bedToGarden(bed({ cx: 100, cy: 50 }), { x: 0, y: 0 })).toEqual({ x: 52, y: 26 });
  });

  it('round-trips a point, including through a rotated bed', () => {
    for (const rotationDeg of [0, 45, 90, 270]) {
      const b = bed({ cx: 30, cy: -10, rotationDeg });
      const back = gardenToBed(b, bedToGarden(b, { x: 17, y: 5 }));
      expect(back.x).toBeCloseTo(17);
      expect(back.y).toBeCloseTo(5);
    }
  });

  it('turns a bed clockwise about its center', () => {
    // Rotated 90°, the top-left corner swings round to the top-right of the footprint.
    const p = bedToGarden(bed({ rotationDeg: 90 }), { x: 0, y: 0 });
    expect(p.x).toBeCloseTo(48 + 24);
    expect(p.y).toBeCloseTo(24 - 48);
  });
});

describe('bedBounds / gardenBounds', () => {
  it('spans the bed’s own rectangle when unrotated', () => {
    expect(bedBounds(bed())).toEqual({ x0: 0, y0: 0, x1: 96, y1: 48 });
  });

  it('covers the swung footprint of a bed rotated 90°', () => {
    const b = bedBounds(bed({ rotationDeg: 90 }));
    expect(b.x0).toBeCloseTo(24);
    expect(b.x1).toBeCloseTo(72);
    expect(b.y0).toBeCloseTo(-24);
    expect(b.y1).toBeCloseTo(72);
  });

  it('is null for a garden with no beds', () => {
    expect(gardenBounds([])).toBeNull();
  });

  it('spans every bed', () => {
    const beds = [bed(), bed({ id: 'b2', cx: 150, cy: -6, widthIn: 12, heightIn: 12 })];
    expect(gardenBounds(beds)).toEqual({ x0: 0, y0: -12, x1: 156, y1: 48 });
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

describe('resizeBedTo', () => {
  it('holds the left edge when the right edge is dragged', () => {
    const next = resizeBedTo(bed(), 120, 48, { sx: 1, sy: 0 });
    expect(bedBounds(next)).toEqual({ x0: 0, y0: 0, x1: 120, y1: 48 });
  });

  it('holds the right edge when the left edge is dragged', () => {
    const next = resizeBedTo(bed(), 60, 48, { sx: -1, sy: 0 });
    expect(bedBounds(next)).toEqual({ x0: 36, y0: 0, x1: 96, y1: 48 });
  });

  it('holds the opposite corner when a corner is dragged', () => {
    const next = resizeBedTo(bed(), 72, 36, { sx: -1, sy: -1 });
    expect(bedBounds(next)).toEqual({ x0: 24, y0: 12, x1: 96, y1: 48 });
  });

  it('leaves the other axis’ center alone for an edge handle', () => {
    const next = resizeBedTo(bed(), 96, 60, { sx: 0, sy: 1 });
    expect(next.cx).toBe(48);
    expect(bedBounds(next)).toEqual({ x0: 0, y0: 0, x1: 96, y1: 60 });
  });

  it('keeps identity, name, and rotation', () => {
    const b = bed({ name: 'Herbs', rotationDeg: 90 });
    const next = resizeBedTo(b, 60, 60, { sx: 1, sy: 1 });
    expect({ id: next.id, name: next.name, shape: next.shape, rotationDeg: next.rotationDeg }).toEqual({
      id: 'b1',
      name: 'Herbs',
      shape: 'rect',
      rotationDeg: 90,
    });
  });
});

describe('resizeFromPointer', () => {
  it('snaps the dragged side to the grid', () => {
    expect(resizeFromPointer(bed(), { sx: 1, sy: 0 }, { x: 110, y: 999 }).widthIn).toBe(108);
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

describe('relocatePlants', () => {
  it('keeps plants at the same garden position when the left edge moves in', () => {
    const b = bed();
    const next = resizeBedTo(b, 72, 48, { sx: -1, sy: 0 }); // left edge 0 → 24
    const { plants } = relocatePlants(b, next, [plant('a', 50, 20)]);
    expect(plants[0]).toMatchObject({ x: 26, y: 20 });
    expect(bedToGarden(next, plants[0])).toEqual({ x: 50, y: 20 });
  });

  it('counts a plant exactly on the new edge as inside, and one an inch past as outside', () => {
    const b = bed();
    const next = resizeBedTo(b, 60, 48, { sx: 1, sy: 0 }); // right edge 96 → 60
    const { outsideIds } = relocatePlants(b, next, [plant('edge', 60, 24), plant('past', 61, 24)]);
    expect(outsideIds).toEqual(['past']);
  });

  it('treats a plant cut off by the new rounded corner as outside', () => {
    const b = bed({ cornerRadiusIn: 4 });
    const next = resizeBedTo(b, 60, 48, { sx: 1, sy: 0 });
    // On the new right edge but in the corner square, beyond the corner's curve.
    const { outsideIds } = relocatePlants(b, next, [plant('corner', 60, 0.2)]);
    expect(outsideIds).toEqual(['corner']);
  });

  it('keeps a plant in the corner of a bed with square corners (the default)', () => {
    const b = bed();
    const next = resizeBedTo(b, 60, 48, { sx: 1, sy: 0 });
    expect(relocatePlants(b, next, [plant('corner', 60, 0.2)]).outsideIds).toEqual([]);
  });

  it('passes other beds’ plants through untouched (same object)', () => {
    const other = plant('o', 1, 1, 'b2');
    const b = bed();
    const { plants, outsideIds } = relocatePlants(b, resizeBedTo(b, 12, 12, { sx: 1, sy: 1 }), [other]);
    expect(plants[0]).toBe(other);
    expect(outsideIds).toEqual([]);
  });
});

describe('nextBedName', () => {
  it('numbers from the bed count', () => {
    expect(nextBedName([bed()])).toBe('Bed 2');
    expect(nextBedName([])).toBe('Bed 1');
  });

  it('skips a name that is already taken, ignoring case and stray spaces', () => {
    expect(nextBedName([bed({ name: ' bed 2 ' })])).toBe('Bed 3');
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

describe('view math', () => {
  const view = { zoom: 2, x: 10, y: 20 };

  it('maps screen offsets to garden points', () => {
    expect(screenToGarden(view, 0, 0)).toEqual({ x: 10, y: 20 });
    expect(screenToGarden(view, 40, 10)).toEqual({ x: 30, y: 25 });
  });

  it('zoomAt keeps the point under the cursor fixed', () => {
    const next = zoomAt(view, 40, 10, 2);
    expect(next.zoom).toBe(4);
    expect(screenToGarden(next, 40, 10)).toEqual(screenToGarden(view, 40, 10));
  });

  it('zoomAt clamps at both ends', () => {
    expect(zoomAt(view, 0, 0, 1000).zoom).toBe(MAX_ZOOM);
    expect(zoomAt(view, 0, 0, 0.0001).zoom).toBe(MIN_ZOOM);
  });

  it('panBy moves the camera against the drag', () => {
    expect(panBy(view, 20, -10)).toEqual({ zoom: 2, x: 0, y: 25 });
  });

  it('fitView centers the garden in the area the insets leave clear', () => {
    const insets = { left: 100, right: 0, top: 0, bottom: 0 };
    const v = fitView({ x0: 0, y0: 0, x1: 100, y1: 50 }, 600, 300, insets);
    expect(v.zoom).toBe(5); // 500px / 100″ and 300px / 50″ → the tighter 5
    const center = screenToGarden(v, 100 + 250, 150);
    expect(center.x).toBeCloseTo(50);
    expect(center.y).toBeCloseTo(25);
  });

  it('fitView frames a default patch for an empty garden', () => {
    const v = fitView(null, 960, 480, { left: 0, right: 0, top: 0, bottom: 0 });
    expect(v.zoom).toBe(10);
    expect(screenToGarden(v, 0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('zoomPercent is relative to the planting view’s scale', () => {
    expect(zoomPercent({ zoom: 7, x: 0, y: 0 })).toBe(100);
    expect(zoomPercent({ zoom: 3.5, x: 0, y: 0 })).toBe(50);
  });
});

describe('normalizeSide', () => {
  it('snaps to the grid', () => {
    expect(normalizeSide(50)).toBe(48);
    expect(normalizeSide(51)).toBe(54);
  });

  it('keeps exactly the minimum, and raises anything below it', () => {
    expect(normalizeSide(MIN_BED_SIDE_IN)).toBe(MIN_BED_SIDE_IN);
    expect(normalizeSide(MIN_BED_SIDE_IN - 6)).toBe(MIN_BED_SIDE_IN);
    expect(normalizeSide(0)).toBe(MIN_BED_SIDE_IN);
  });
});

describe('plantSummary', () => {
  it('counts each crop in order of first appearance', () => {
    const plants = [plant('a', 0, 0), { ...plant('b', 0, 0), cropId: 'basil' }, plant('c', 0, 0)];
    expect(plantSummary(plants)).toBe('Tomato ×2, Basil ×1');
  });

  it('is empty for no plants', () => {
    expect(plantSummary([])).toBe('');
  });
});

describe('boxBetween', () => {
  it('spans two points whichever way round they are', () => {
    expect(boxBetween({ x: 10, y: 2 }, { x: 4, y: 8 })).toEqual({ x: 4, y: 2, width: 6, height: 6 });
  });
});

describe('drawnCornerRadius', () => {
  it('is square for a bed with no radius of its own', () => {
    expect(BED_CORNER_RADIUS_IN).toBe(0);
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 48 })).toBe(0);
  });

  it('uses the bed\'s own radius, including none at all', () => {
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 48, cornerRadiusIn: 10 })).toBe(10);
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 48, cornerRadiusIn: 0 })).toBe(0);
  });

  it('never curves more than half the short side', () => {
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 6, cornerRadiusIn: 10 })).toBe(3);
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 48, cornerRadiusIn: 24 })).toBe(24);
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 48, cornerRadiusIn: 25 })).toBe(24);
  });
});

describe('normalizeCornerRadius', () => {
  const bed = { widthIn: 96, heightIn: 48 };
  it('rounds to whole inches', () => {
    expect(normalizeCornerRadius(5.4, bed)).toBe(5);
    expect(normalizeCornerRadius(5.5, bed)).toBe(6);
  });
  it('holds between square and half the short side', () => {
    expect(normalizeCornerRadius(-3, bed)).toBe(0);
    expect(normalizeCornerRadius(24, bed)).toBe(24);
    expect(normalizeCornerRadius(25, bed)).toBe(24);
    expect(normalizeCornerRadius(7, { widthIn: 13, heightIn: 13 })).toBe(6);
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

describe('gardenToScreen', () => {
  it('inverts screenToGarden', () => {
    const view = { zoom: 2.5, x: 30, y: -12 };
    const p = screenToGarden(view, 140, 66);
    const back = gardenToScreen(view, p);
    expect(back.x).toBeCloseTo(140);
    expect(back.y).toBeCloseTo(66);
  });
});

describe('isDrag', () => {
  it('treats exactly the slop as still a click, and anything past it as a drag', () => {
    expect(isDrag(3, 0)).toBe(false);
    expect(isDrag(3.01, 0)).toBe(true);
    expect(isDrag(3, 3)).toBe(true);
  });
});

describe('wheelZoomFactor', () => {
  it('zooms in for a scroll up and out for a scroll down, symmetrically', () => {
    expect(wheelZoomFactor(-10)).toBeGreaterThan(1);
    expect(wheelZoomFactor(10)).toBeLessThan(1);
    expect(wheelZoomFactor(-10) * wheelZoomFactor(10)).toBeCloseTo(1);
    expect(wheelZoomFactor(0)).toBe(1);
  });

  it('caps a mouse-wheel notch at the same step as the maximum delta', () => {
    expect(wheelZoomFactor(100)).toBe(wheelZoomFactor(MAX_WHEEL_ZOOM_DELTA));
    expect(wheelZoomFactor(-100)).toBe(wheelZoomFactor(-MAX_WHEEL_ZOOM_DELTA));
    expect(wheelZoomFactor(MAX_WHEEL_ZOOM_DELTA - 1)).toBeGreaterThan(wheelZoomFactor(MAX_WHEEL_ZOOM_DELTA));
  });
});

const L_POINTS = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 24 },
  { x: 48, y: 24 },
  { x: 48, y: 48 },
  { x: 0, y: 48 },
];
function polyBed(over: Partial<Bed> = {}): Bed {
  return bed({ id: 'p', shape: 'polygon', cx: 24, cy: 24, widthIn: 48, heightIn: 48, points: L_POINTS, ...over });
}

describe('bedOutline', () => {
  it('rounds a rectangle’s corners, and passes ellipse and polygon shapes through', () => {
    expect(bedOutline(bed())).toEqual({ shape: 'rect', widthIn: 96, heightIn: 48, cornerRadiusIn: BED_CORNER_RADIUS_IN });
    expect(bedOutline(bed({ shape: 'ellipse' }))).toEqual({ shape: 'ellipse', widthIn: 96, heightIn: 48 });
    expect(bedOutline(polyBed())).toEqual({ shape: 'polygon', widthIn: 48, heightIn: 48, points: L_POINTS });
  });
});

describe('geometryOf', () => {
  it('includes corners only for a polygon', () => {
    expect(geometryOf(bed())).toEqual({ cx: 48, cy: 24, widthIn: 96, heightIn: 48 });
    expect(geometryOf(polyBed()).points).toBe(L_POINTS);
  });

  it('carries a bed\'s own corner radius, even a square one', () => {
    expect(geometryOf({ ...bed(), cornerRadiusIn: 0 }).cornerRadiusIn).toBe(0);
  });
});

describe('resizeBedTo with a polygon', () => {
  it('scales the corners with the box', () => {
    const next = resizeBedTo(polyBed(), 96, 24, { sx: 1, sy: 1 });
    expect(next.points).toEqual([
      { x: 0, y: 0 },
      { x: 48, y: 0 },
      { x: 48, y: 12 },
      { x: 96, y: 12 },
      { x: 96, y: 24 },
      { x: 0, y: 24 },
    ]);
    expect(bedBounds(next)).toEqual({ x0: 0, y0: 0, x1: 96, y1: 24 });
  });
});

describe('relocatePlants with non-rectangular beds', () => {
  it('flags a plant that a shrinking ellipse no longer covers, even inside its box', () => {
    const e = bed({ shape: 'ellipse' });
    const next = resizeBedTo(e, 96, 48, { sx: 1, sy: 1 }); // same size: the box corner is still outside
    const { outsideIds } = relocatePlants(e, next, [plant('corner', 2, 2), plant('mid', 48, 24)]);
    expect(outsideIds).toEqual(['corner']);
  });

  it('flags a plant left in a polygon’s new notch', () => {
    const square = polyBed({ points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: 48 }, { x: 0, y: 48 }] });
    const { outsideIds } = relocatePlants(square, polyBed(), [plant('notch', 40, 10, 'p'), plant('arm', 10, 10, 'p')]);
    expect(outsideIds).toEqual(['notch']);
  });
});

describe('signedArea2', () => {
  it('is positive for corners running clockwise on screen, negative counter-clockwise, 0 for a line', () => {
    const cw = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
    expect(signedArea2(cw)).toBe(100);
    expect(signedArea2([...cw].reverse())).toBe(-100);
    expect(signedArea2([{ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 }])).toBe(0);
  });
});

describe('polygonFromCorners', () => {
  it('centers the box on the corners and makes the corners box-relative', () => {
    const g = polygonFromCorners([{ x: 12, y: 6 }, { x: 60, y: 6 }, { x: 12, y: 54 }]);
    expect(g).toEqual({ cx: 36, cy: 30, widthIn: 48, heightIn: 48, points: [{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 0, y: 48 }] });
  });

  it('rejects two corners, corners all in a line, and a box under the minimum side', () => {
    expect(polygonFromCorners([{ x: 0, y: 0 }, { x: 48, y: 48 }])).toBeNull();
    expect(polygonFromCorners([{ x: 0, y: 0 }, { x: 24, y: 24 }, { x: 48, y: 48 }])).toBeNull();
    expect(polygonFromCorners([{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: MIN_BED_SIDE_IN - 6 }])).toBeNull();
  });

  it('accepts a box exactly at the minimum side', () => {
    expect(polygonFromCorners([{ x: 0, y: 0 }, { x: 48, y: 0 }, { x: 48, y: MIN_BED_SIDE_IN }])).not.toBeNull();
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

describe('boxCorners', () => {
  it('lists the corners clockwise from the top-left, turning with the bed', () => {
    expect(boxCorners(bed())).toEqual([{ x: 0, y: 0 }, { x: 96, y: 0 }, { x: 96, y: 48 }, { x: 0, y: 48 }]);
    const c = boxCorners(bed({ rotationDeg: 90 }));
    // Turned 90° clockwise about (48, 24): the top-left corner swings to the top-right.
    expect(c[0].x).toBeCloseTo(72);
    expect(c[0].y).toBeCloseTo(-24);
  });
});

describe('normalizeAngle / snapAngle', () => {
  it('brings angles into 0…360', () => {
    expect(normalizeAngle(-45)).toBe(315);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(725)).toBe(5);
    expect(Object.is(normalizeAngle(-360), 0)).toBe(true);
  });

  it('snaps to the nearest 45°, rounding half-way up, and wraps', () => {
    expect(snapAngle(22.4)).toBe(0);
    expect(snapAngle(22.5)).toBe(45);
    expect(snapAngle(-22.6)).toBe(315);
    expect(snapAngle(350)).toBe(0);
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

  it('snaps to 45° steps', () => {
    expect(rotationFromPointer(center, { x: 10, y: -9 })).toBe(45);
    expect(rotationFromPointer(center, { x: 3, y: -10 })).toBe(0);
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

describe('resizeBedTo on a turned bed', () => {
  it('still holds the side opposite the handle in place', () => {
    const b = bed({ rotationDeg: 90 });
    const before = boxCorners(b);
    const next = resizeBedTo(b, 120, 48, { sx: 1, sy: 0 }); // the bed's own right edge
    const after = boxCorners(next);
    // Its left edge (top-left and bottom-left corners) doesn't move.
    for (const i of [0, 3]) {
      expect(after[i].x).toBeCloseTo(before[i].x);
      expect(after[i].y).toBeCloseTo(before[i].y);
    }
    expect(next.rotationDeg).toBe(90);
  });
});

describe('copyName', () => {
  it('appends "copy", then numbers further copies', () => {
    expect(copyName('Herbs', [bed({ name: 'Herbs' })])).toBe('Herbs copy');
    expect(copyName('Herbs', [bed({ name: 'Herbs' }), bed({ name: 'herbs copy' })])).toBe('Herbs copy 2');
    expect(copyName('Herbs', [bed({ name: 'Herbs copy' }), bed({ name: 'Herbs copy 2' })])).toBe('Herbs copy 3');
  });
});

describe('cloneBed', () => {
  let n = 0;
  const makeId = () => `id${++n}`;

  it('copies the bed offset on both axes with a new id and name, keeping shape and rotation', () => {
    n = 0;
    const src = polyBed({ name: 'Corner', rotationDeg: 45 });
    const { bed: copy } = cloneBed(src, [], 12, makeId, [src]);
    expect(copy).toEqual({ ...src, id: 'id1', name: 'Corner copy', cx: src.cx + 12, cy: src.cy + 12 });
  });

  it('copies only that bed’s plants, with new ids, at the same bed-local spots', () => {
    n = 0;
    const src = bed();
    const plants = [plant('a', 10, 10), plant('other', 5, 5, 'b2')];
    const { bed: copy, plants: copied } = cloneBed(src, plants, 12, makeId, [src]);
    expect(copied).toHaveLength(1);
    expect(copied[0]).toMatchObject({ bedId: copy.id, x: 10, y: 10, cropId: 'tomato' });
    expect(copied[0].id).not.toBe('a');
  });

  it('gives each copied patch one new group id, never the original’s', () => {
    n = 0;
    const src = bed();
    const plants = [
      { ...plant('a', 10, 10), groupId: 'patch' },
      { ...plant('b', 14, 10), groupId: 'patch' },
      { ...plant('c', 40, 10), groupId: 'solo' },
    ];
    const { plants: copied } = cloneBed(src, plants, 12, makeId, [src]);
    expect(copied[0].groupId).toBe(copied[1].groupId);
    expect(copied[2].groupId).not.toBe(copied[0].groupId);
    for (const p of copied) expect(['patch', 'solo']).not.toContain(p.groupId);
  });
});
