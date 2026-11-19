import { describe, expect, it } from 'vitest';
import { isSolverRoute, isSpritesRoute } from './route';

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

describe('isSolverRoute', () => {
  it('matches the path and the hash form, with or without a base path or trailing slash', () => {
    expect(isSolverRoute('/_solver', '')).toBe(true);
    expect(isSolverRoute('/garden-planner/pr-preview/pr-1/_solver/', '')).toBe(true);
    expect(isSolverRoute('/', '#/_solver')).toBe(true);
  });
  it('does not match the sprite sheet or a look-alike', () => {
    expect(isSolverRoute('/_sprites', '')).toBe(false);
    expect(isSolverRoute('/my_solver', '')).toBe(false);
    expect(isSolverRoute('/_solver/more', '')).toBe(false);
    expect(isSolverRoute('/', '#/solver')).toBe(false);
  });
});
