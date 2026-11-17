import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../core/random';
import { DiscIndex, type Disc } from './discIndex';

const near = (idx: DiscIndex, x: number, y: number, r: number) => {
  const out: string[] = [];
  idx.forEachNear(x, y, r, (d) => out.push(`${d.group}@${d.x},${d.y}`));
  return out.sort();
};

describe('DiscIndex', () => {
  it('finds discs within the radius, the boundary included, across bucket edges', () => {
    const idx = new DiscIndex(10);
    idx.add({ x: 9.9, y: 0, spacingIn: 10, group: 'a' });
    idx.add({ x: 10.1, y: 0, spacingIn: 10, group: 'b' });
    idx.add({ x: 20, y: 0, spacingIn: 10, group: 'c' });
    expect(near(idx, 10, 0, 0.1)).toEqual(['a@9.9,0', 'b@10.1,0']);
    expect(near(idx, 10, 0, 10)).toEqual(['a@9.9,0', 'b@10.1,0', 'c@20,0']);
    expect(near(idx, 10, 0, 9.99)).toEqual(['a@9.9,0', 'b@10.1,0']);
  });

  it('handles negative coordinates', () => {
    const idx = new DiscIndex(10);
    idx.add({ x: -3, y: -3, spacingIn: 4, group: 'a' });
    expect(near(idx, -1, -1, 3)).toEqual(['a@-3,-3']);
    expect(near(idx, 5, 5, 3)).toEqual([]);
  });

  it('removes a whole group and only that group', () => {
    const idx = new DiscIndex(10);
    for (let i = 0; i < 3; i++) idx.add({ x: i, y: 0, spacingIn: 4, group: 'a' });
    idx.add({ x: 1, y: 1, spacingIn: 4, group: 'b' });
    idx.removeGroup('a');
    expect(idx.size).toBe(1);
    expect(near(idx, 0, 0, 5)).toEqual(['b@1,1']);
    idx.removeGroup('a'); // already gone
    idx.removeGroup('nope');
    expect(idx.size).toBe(1);
  });

  it('agrees with a brute-force scan on random points', () => {
    const next = mulberry32(5);
    const idx = new DiscIndex(12);
    const discs: Disc[] = Array.from({ length: 300 }, (_, i) => ({ x: next() * 200 - 20, y: next() * 100 - 20, spacingIn: 10, group: `g${i % 7}` }));
    for (const d of discs) idx.add(d);
    for (let i = 0; i < 50; i++) {
      const x = next() * 200 - 20;
      const y = next() * 100 - 20;
      const r = next() * 30;
      const expected = discs.filter((d) => Math.hypot(d.x - x, d.y - y) <= r).map((d) => `${d.group}@${d.x},${d.y}`).sort();
      expect(near(idx, x, y, r)).toEqual(expected);
    }
  });

  it('refuses a bucket size that is not above 0', () => {
    expect(() => new DiscIndex(0)).toThrow();
  });
});
