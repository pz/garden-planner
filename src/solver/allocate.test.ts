import { describe, expect, it } from 'vitest';
import type { Bed } from '../types';
import { bedArea, plantArea, targetCount } from './allocate';

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
