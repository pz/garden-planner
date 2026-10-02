import { describe, expect, it } from 'vitest';
import type { Bed, PlantInstance } from '../types';
import {
  BED_CORNER_RADIUS_IN,
  MAX_ZOOM,
  MIN_BED_SIDE_IN,
  MIN_ZOOM,
  bedBounds,
  bedToGarden,
  boxBetween,
  drawnCornerRadius,
  isDrag,
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
    const b = bed();
    const next = resizeBedTo(b, 60, 48, { sx: 1, sy: 0 });
    // On the new right edge but in the corner square, beyond the corner's curve.
    const { outsideIds } = relocatePlants(b, next, [plant('corner', 60, 0.2)]);
    expect(BED_CORNER_RADIUS_IN).toBeGreaterThan(0.2);
    expect(outsideIds).toEqual(['corner']);
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
  it('uses the standard radius for a normal bed', () => {
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 48 })).toBe(BED_CORNER_RADIUS_IN);
  });

  it('shrinks to a quarter of the short side for a sliver', () => {
    expect(drawnCornerRadius({ widthIn: 96, heightIn: 8 })).toBe(2);
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
