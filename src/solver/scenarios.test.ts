import { describe, expect, it } from 'vitest';
import { scenarioNames, loadScenario } from './catalog';
import { runScenario } from './check';

// One test per scenario file: its own expectations plus the invariants every proposal must have.
// Scenarios that need a feature from a later milestone are listed here until it lands.
const PENDING: Record<string, string> = {
  'adjust-more-tomatoes': 'adjust mode (milestone 5)',
  'adjust-locked': 'adjust mode (milestone 5)',
  'adjust-swap-beans': 'adjust mode (milestone 5)',
  'replace-bed-2': 'replace mode (milestone 5)',
};

describe('scenarios', () => {
  for (const name of scenarioNames()) {
    (PENDING[name] ? it.skip : it)(PENDING[name] ? `${name} — pending: ${PENDING[name]}` : name, () => {
      const { problems } = runScenario(loadScenario(name));
      expect(problems).toEqual([]);
    });
  }
});
