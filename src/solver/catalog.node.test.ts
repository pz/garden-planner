import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GARDEN_FILES, SCENARIO_FILES, SPEC_FILES } from './catalog';

// Needs Node's fs, so it is typechecked by tsconfig.node.json, not the DOM-free tsconfig.core.json.
const names = (dir: string, suffix: string) =>
  readdirSync(new URL(`./fixtures/${dir}/`, import.meta.url))
    .filter((f) => f.endsWith(suffix))
    .map((f) => f.slice(0, -suffix.length))
    .sort();

describe('fixture registry', () => {
  it('lists every file in fixtures/ and nothing else', () => {
    expect(Object.keys(GARDEN_FILES).sort()).toEqual(names('gardens', '.garden.json'));
    expect(Object.keys(SPEC_FILES).sort()).toEqual(names('specs', '.spec.json'));
    expect(Object.keys(SCENARIO_FILES).sort()).toEqual(names('scenarios', '.scenario.json'));
  });
});
