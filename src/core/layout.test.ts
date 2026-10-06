import { describe, expect, it } from 'vitest';
import {
  BED_CORNER_RADIUS_IN,
  MIN_BED_SIDE_IN,
  bedBounds,
  bedOutline,
  bedToGarden,
  boxCorners,
  cloneBed,
  copyName,
  drawnCornerRadius,
  gardenBounds,
  gardenToBed,
  geometryOf,
  nextBedName,
  normalizeAngle,
  normalizeCornerRadius,
  normalizeSide,
  outlinePoints,
  plantSummary,
  polygonFromCorners,
  relocatePlants,
  resizeBedTo,
  signedArea2,
  snapAngle,
} from './layout';
import type { Bed, PlantInstance } from '../types';


function bed(over: Partial<Bed> = {}): Bed {
  // 8′ × 4′ with its top-left at the garden origin.
  return { id: 'b1', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0, ...over };
}

function plant(id: string, x: number, y: number, bedId = 'b1'): PlantInstance {
  return { id, bedId, cropId: 'tomato', x, y, groupId: id };
}
function polyBed(over: Partial<Bed> = {}): Bed {
  return bed({ id: 'p', shape: 'polygon', cx: 24, cy: 24, widthIn: 48, heightIn: 48, points: L_POINTS, ...over });
}

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

describe('normalizeSide', () => {
  it('rounds to whole inches', () => {
    expect(normalizeSide(50)).toBe(50);
    expect(normalizeSide(50.4)).toBe(50);
    expect(normalizeSide(50.6)).toBe(51);
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

const L_POINTS = [
  { x: 0, y: 0 },
  { x: 24, y: 0 },
  { x: 24, y: 24 },
  { x: 48, y: 24 },
  { x: 48, y: 48 },
  { x: 0, y: 48 },
];

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

describe('outlinePoints', () => {
  it('is the box for a rectangle and the turned corners for a polygon', () => {
    expect(outlinePoints(bed())).toHaveLength(4);
    const p = polyBed();
    expect(outlinePoints(p)).toHaveLength(p.points!.length);
  });
  it('stays on the ellipse', () => {
    const e = bed({ shape: 'ellipse' });
    for (const q of outlinePoints(e)) {
      const nx = (q.x - 48) / 48;
      const ny = (q.y - 24) / 24;
      expect(nx * nx + ny * ny).toBeCloseTo(1, 9);
    }
  });
});