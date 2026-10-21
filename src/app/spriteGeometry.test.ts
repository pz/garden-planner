import { describe, expect, it } from 'vitest';
import { edgePath, featherPath, leafPath, polar, polarPath, spokes, spriteRotation } from './spriteGeometry';

describe('spokes', () => {
  it('spaces n spokes evenly from the start angle', () => {
    expect(spokes(4, 10)).toEqual([10, 100, 190, 280]);
  });
  it('returns nothing for zero spokes', () => {
    expect(spokes(0, 0)).toEqual([]);
  });
});

describe('polar', () => {
  it('maps an angle and distance to x/y', () => {
    const [x, y] = polar(90, 2);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(2);
  });
});

describe('spriteRotation', () => {
  it('is stable per id and within a turn', () => {
    expect(spriteRotation('plant-1')).toBe(spriteRotation('plant-1'));
    for (const id of ['', 'a', 'plant-123', 'x'.repeat(200)]) {
      const r = spriteRotation(id);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(360);
    }
  });
  it('differs between ids', () => {
    const rots = new Set(Array.from({ length: 20 }, (_, i) => spriteRotation(`p${i}`)));
    expect(rots.size).toBeGreaterThan(10);
  });
});

describe('paths', () => {
  const NUM = /-?\d+(\.\d+)?/g;
  it.each(['oval', 'strap', 'obovate', 'ruffle', 'basil', 'lobed'] as const)('%s is a closed path with finite numbers', (shape) => {
    const d = leafPath(shape, 1, 0.5);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect((d.match(NUM) ?? []).length).toBeGreaterThan(4);
  });
  it('edgePath runs from x=0 to x=len', () => {
    const d = edgePath(2, () => 0.1, 4);
    expect(d.startsWith('M0.000 -0.100')).toBe(true);
    expect(d).toContain('L2.000 -0.100');
  });
  it('polarPath closes back on its first point', () => {
    const d = polarPath(0, 1, () => 1, 8);
    const pts = d.slice(1, -1).split(/[LM]/);
    const [a, b] = [pts[0], pts[pts.length - 1]].map((p) => p.split(' ').map(Number));
    expect(b[0]).toBeCloseTo(a[0]);
    expect(b[1]).toBeCloseTo(a[1]);
  });
  it('featherPath adds two veins per pair, and branchlets when fine', () => {
    const plain = featherPath(1, 3);
    const fine = featherPath(1, 3, true);
    expect((plain.match(/l/g) ?? []).length).toBe(6);
    expect((fine.match(/l/g) ?? []).length).toBe(12);
  });
});
