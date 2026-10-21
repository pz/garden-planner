import { describe, expect, it } from 'vitest';
import { CROPS } from '../data/crops';
import { hasSprite } from './components/PlantSprite';
import { ACCENTS, LEAF_COLORS, SHAPES, SPR, drawSpec } from './sprites';

describe('sprites', () => {
  it('has a sprite for every crop, so none falls back to a flat disc', () => {
    expect(CROPS.filter((c) => !hasSprite(c.id)).map((c) => c.id)).toEqual([]);
  });

  it('draws every sprite at any turn without producing NaN', () => {
    for (const [key, draw] of Object.entries(SPR)) {
      for (const rot of [0, 37, 359]) {
        const json = JSON.stringify(draw(rot), (_, v) => (typeof v === 'number' && !Number.isFinite(v) ? 'BAD' : v));
        expect(json, `${key} at ${rot}`).not.toContain('"BAD"');
        expect(draw(rot).length, key).toBeGreaterThan(0);
      }
    }
  });

  it('draws a user-made plant from every generic shape, color and accent, or as another plant', () => {
    for (const shape of SHAPES) expect(drawSpec({ shape: shape.id, leaf: LEAF_COLORS[1].id, accent: ACCENTS[2].id }, 10)).toBeTruthy();
    expect(drawSpec({ like: 'tomato' }, 0)).toBeTruthy();
    expect(drawSpec({}, 0)).toBeTruthy(); // unknown spec: the default look, not a crash
  });
});
