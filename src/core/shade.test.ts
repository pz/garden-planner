import { describe, expect, it } from 'vitest';
import type { Bed, PlantInstance } from '../types';
import { SHADE_HEIGHT_MARGIN_IN, SHADE_REACH_FACTOR, findShadeConflicts, shadowDirection } from './shade';

// bed-1 is 96×48 with its top-left at the garden origin, so bed coordinates are garden coordinates.
const bed1: Bed = { id: 'bed-1', name: 'Bed 1', shape: 'rect', cx: 48, cy: 24, widthIn: 96, heightIn: 48, rotationDeg: 0 };
const plant = (id: string, cropId: string, x: number, y: number, over: Partial<PlantInstance> = {}): PlantInstance => ({ id, bedId: 'bed-1', cropId, x, y, groupId: id, ...over });
const shaded = (plants: PlantInstance[], beds: Bed[] = [bed1], northDeg = 0, lat: number | undefined = 40) =>
  findShadeConflicts(plants, beds, northDeg, lat).map((c) => `${c.caster}>${c.shaded}`);

describe('shadowDirection', () => {
  const near = (p: { x: number; y: number }, x: number, y: number) => {
    expect(p.x).toBeCloseTo(x, 9);
    expect(p.y).toBeCloseTo(y, 9);
  };

  it('is up (toward north) in the northern hemisphere when up is north', () => {
    near(shadowDirection(0, 40), 0, -1);
  });

  it('turns with northDeg, clockwise from straight up: 90 puts north to the right, 180 down, 270 to the left', () => {
    near(shadowDirection(90, 40), 1, 0);
    near(shadowDirection(180, 40), 0, 1);
    near(shadowDirection(270, 40), -1, 0);
  });

  it('flips for the southern hemisphere, and treats no latitude or the equator as northern', () => {
    near(shadowDirection(0, -30), 0, 1);
    near(shadowDirection(0, 0), 0, -1);
    near(shadowDirection(0, undefined), 0, -1);
  });
});

describe('findShadeConflicts', () => {
  // tomato: 48 in tall, spacing 24 → casts a shadow up to 0.6 × 48 = 28.8 in, in a band 12 in either side.
  const tomato = plant('t', 'tomato', 40, 40);

  it('shades a full-sun crop just north of a much taller one', () => {
    expect(shaded([tomato, plant('b', 'basil', 40, 30)])).toEqual(['t>b']);
  });

  it('does not shade one to the south, or level with it', () => {
    expect(shaded([tomato, plant('b', 'basil', 40, 45)])).toEqual([]);
    expect(shaded([tomato, plant('b', 'basil', 40, 40.01)])).toEqual([]);
    expect(shaded([tomato, plant('b', 'basil', 60, 40)])).toEqual([]); // to the side, not ahead
  });

  it('reaches exactly 0.6 of the height ahead and not a hair further', () => {
    const reach = 48 * SHADE_REACH_FACTOR;
    expect(shaded([tomato, plant('b', 'basil', 40, 40 - reach)])).toEqual(['t>b']);
    expect(shaded([tomato, plant('b', 'basil', 40, 40 - reach - 0.01)])).toEqual([]);
  });

  it('covers a band as wide as the shading plant, exactly to its half-width', () => {
    expect(shaded([tomato, plant('b', 'basil', 52, 30)])).toEqual(['t>b']); // 12 in to the side
    expect(shaded([tomato, plant('b', 'basil', 52.01, 30)])).toEqual([]);
  });

  it('needs the shader to be at least the margin taller: exactly 12 in counts, less does not', () => {
    // squash 30 in vs basil 18 in: exactly the margin. Squash spacing 36 → reach 18, band 18.
    expect(30 - 18).toBe(SHADE_HEIGHT_MARGIN_IN);
    expect(shaded([plant('s', 'squash', 40, 40), plant('b', 'basil', 40, 30)])).toEqual(['s>b']);
    // kale 24 vs basil 18: only 6 taller.
    expect(shaded([plant('k', 'kale', 40, 40), plant('b', 'basil', 40, 30)])).toEqual([]);
  });

  it('never shades a crop that tolerates partial shade', () => {
    expect(shaded([tomato, plant('l', 'lettuce', 40, 30)])).toEqual([]);
    expect(shaded([tomato, plant('c', 'carrot', 40, 30)])).toEqual([]);
  });

  it('never shades within one patch', () => {
    expect(shaded([tomato, plant('t2', 'tomato', 40, 30, { groupId: 't' })])).toEqual([]);
  });

  it('follows which way north points on the plan', () => {
    const west = plant('b', 'basil', 30, 40); // to the left of the tomato
    const east = plant('b', 'basil', 50, 40); // to the right of it
    expect(shaded([tomato, west], [bed1], 0)).toEqual([]);
    expect(shaded([tomato, west], [bed1], 270)).toEqual(['t>b']); // north is left, so the shadow falls left
    expect(shaded([tomato, east], [bed1], 90)).toEqual(['t>b']); // north is right
    expect(shaded([tomato, east], [bed1], 270)).toEqual([]);
    expect(shaded([tomato, plant('b', 'basil', 40, 50)], [bed1], 180)).toEqual(['t>b']); // north is down, so shadows fall down
  });

  it('flips in the southern hemisphere', () => {
    const south = plant('b', 'basil', 40, 50);
    expect(shaded([tomato, south], [bed1], 0, 40)).toEqual([]);
    expect(shaded([tomato, south], [bed1], 0, -40)).toEqual(['t>b']);
  });

  it('works across beds, in garden coordinates', () => {
    // A second bed above the first, overlapping its top edge: its local (40, 40) is garden (40, 16), 24 in north of the tomato.
    const above: Bed = { ...bed1, id: 'above', cx: 48, cy: 0 };
    const basilAbove = plant('b', 'basil', 40, 40, { bedId: 'above' });
    expect(shaded([tomato, basilAbove], [bed1, above])).toEqual(['t>b']);
    // Further up, the same plant is beyond the shadow's reach (0.6 × 48 = 28.8 in).
    expect(shaded([tomato, basilAbove], [bed1, { ...above, cy: -10 }])).toEqual([]);
  });

  it('allows for a turned bed', () => {
    // Turned 90° clockwise about its center, a bed's local +y points west in the garden, so a basil
    // 10 in further along local y than the tomato (at the center) is 10 in west of it.
    const turned: Bed = { ...bed1, rotationDeg: 90 };
    const t = plant('t', 'tomato', 48, 24);
    const b = plant('b', 'basil', 48, 34);
    expect(shaded([t, b], [turned], 0)).toEqual([]);
    expect(shaded([t, b], [turned], 270)).toEqual(['t>b']); // north points left on the plan, so the shadow falls to the west
  });

  it('reports each patch pair once, with the closest approach', () => {
    const r = findShadeConflicts([tomato, plant('t2', 'tomato', 40, 38, { groupId: 't' }), plant('b', 'basil', 40, 20), plant('b2', 'basil', 40, 30, { groupId: 'b' })], [bed1], 0, 40);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ caster: 't', shaded: 'b', casterCropId: 'tomato', shadedCropId: 'basil' });
    expect(r[0].alongIn).toBe(8); // t2 at y=38 to b2 at y=30
  });

  it('ignores plants whose bed is missing', () => {
    expect(shaded([tomato, plant('b', 'basil', 40, 30, { bedId: 'gone' })])).toEqual([]);
  });
});
