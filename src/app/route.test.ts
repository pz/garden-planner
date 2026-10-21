import { describe, expect, it } from 'vitest';
import { isSpritesRoute } from './route';

describe('isSpritesRoute', () => {
  it('matches the path at the site root, under a base path (a PR preview), and with a trailing slash', () => {
    expect(isSpritesRoute('/_sprites', '')).toBe(true);
    expect(isSpritesRoute('/garden-planner/pr-preview/pr-45/_sprites', '')).toBe(true);
    expect(isSpritesRoute('/_sprites/', '')).toBe(true);
  });

  it('matches the hash form, for hosts that cannot serve the path', () => {
    expect(isSpritesRoute('/garden-planner/', '#/_sprites')).toBe(true);
    expect(isSpritesRoute('/', '#/_sprites/')).toBe(true);
  });

  it('does not match anything else, including a path that only ends in the same letters', () => {
    expect(isSpritesRoute('/', '')).toBe(false);
    expect(isSpritesRoute('/my_sprites', '')).toBe(false);
    expect(isSpritesRoute('/_sprites/more', '')).toBe(false);
    expect(isSpritesRoute('/', '#/other')).toBe(false);
  });
});
