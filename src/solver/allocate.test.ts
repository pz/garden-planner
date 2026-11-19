import { describe, expect, it } from 'vitest';
import type { Bed } from '../types';
import { bedArea, bedPerimeter, insetArea, plantArea, targetCount } from './allocate';

const rect = (w: number, h: number, extra: Partial<Bed> = {}): Bed => ({ id: 'b', name: 'B', shape: 'rect', cx: 0, cy: 0, widthIn: w, heightIn: h, rotationDeg: 0, ...extra });

describe('bedArea', () => {
  it('measures a rectangle, a rounded rectangle, an ellipse and a polygon', () => {
    expect(bedArea(rect(96, 48))).toBe(4608);
    expect(bedArea(rect(48, 48, { cornerRadiusIn: 10 }))).toBeCloseTo(2304 - (4 - Math.PI) * 100, 9);
    expect(bedArea({ ...rect(60, 40), shape: 'ellipse' })).toBeCloseTo(Math.PI * 600, 9);
    expect(bedArea({ ...rect(60, 40), shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 40 }] })).toBe(1200);
  });
  it('limits a corner radius to what fits', () => {
    expect(bedArea(rect(20, 20, { cornerRadiusIn: 500 }))).toBeCloseTo(400 - (4 - Math.PI) * 100, 9);
  });
});

describe('targetCount', () => {
  it('is the weighted share of the filled area over the plant’s square', () => {
    // 4608 in² × 0.5 × (1/2 of the weight) / 24² = 2
    expect(targetCount(4608, 0.5, 1, 2, 24)).toBe(2);
    expect(targetCount(4608, 1, 1, 1, 12)).toBe(32);
  });
  it('rounds to the nearest whole plant', () => {
    expect(targetCount(1000, 1, 1, 1, 10)).toBe(10);
    expect(targetCount(1049, 1, 1, 1, 10)).toBe(10);
    expect(targetCount(1050, 1, 1, 1, 10)).toBe(11);
  });
  it('is at least 1 for a crop that was asked for', () => {
    expect(targetCount(100, 0.1, 1, 10, 36)).toBe(1);
  });
  it('clamps to min and max, max winning only over the computed value', () => {
    expect(targetCount(4608, 1, 1, 1, 12, undefined, 5)).toBe(5);
    expect(targetCount(4608, 1, 1, 100, 12, 4)).toBe(4);
    expect(targetCount(4608, 1, 1, 1, 12, 40, 50)).toBe(40);
  });
});

describe('plantArea', () => {
  it('is a disc of half the spacing', () => {
    expect(plantArea(10)).toBeCloseTo(Math.PI * 25, 9);
  });
});

describe('insetArea', () => {
  it('is the whole bed with no inset', () => {
    expect(insetArea(rect(96, 48), 0)).toBe(4608);
    expect(insetArea(rect(96, 48), -3)).toBe(4608);
  });
  it('shrinks a rectangle and an ellipse on every side, to nothing when the margin takes it all', () => {
    expect(insetArea(rect(96, 48), 6)).toBe(84 * 36);
    expect(insetArea(rect(96, 48), 24)).toBe(0);
    expect(insetArea({ ...rect(60, 40), shape: 'ellipse' }, 10)).toBeCloseTo(Math.PI * 20 * 10, 9);
  });
  it('takes a polygon’s perimeter times the inset off its area', () => {
    const tri = { ...rect(60, 40), shape: 'polygon' as const, points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 0, y: 40 }] };
    expect(insetArea(tri, 1)).toBeCloseTo(1200 - bedPerimeter(tri), 9);
    expect(insetArea(tri, 100)).toBe(0);
  });
});

describe('bedPerimeter', () => {
  it('measures each shape', () => {
    expect(bedPerimeter(rect(96, 48))).toBe(288);
    expect(bedPerimeter({ ...rect(20, 20), shape: 'ellipse' })).toBeCloseTo(2 * Math.PI * 10, 3);
    expect(bedPerimeter({ ...rect(30, 40), shape: 'polygon', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 40 }] })).toBeCloseTo(120, 9);
  });
});
