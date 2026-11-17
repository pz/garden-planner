// The solver's command line: `npm run solve -- <scenario>` or `--list`. Runs under Node via tsx,
// so unlike the rest of src/solver it may use Node APIs (hence the `.node.ts` name, which
// tsconfig.core.json leaves to tsconfig.node.json). The solver itself arrives in a later milestone;
// for now the CLI loads and validates fixtures.
import { gardenNames, loadScenario, scenarioNames } from './catalog';

const args = process.argv.slice(2);

if (args.includes('--list') || args.length === 0) {
  console.log(`Gardens:   ${gardenNames().join(', ')}\nScenarios: ${scenarioNames().join(', ')}\n\nUsage: npm run solve -- <scenario>|--all`);
} else {
  const names = args.includes('--all') ? scenarioNames() : args.filter((a) => !a.startsWith('--'));
  let failed = false;
  for (const name of names) {
    try {
      const s = loadScenario(name);
      console.log(`${name}: ${s.plan.beds.length} bed(s), ${s.plan.plants.length} plant(s), ${s.spec.mode} ${s.spec.demands.map((d) => d.cropId).join(', ')} (solver not implemented yet)`);
    } catch (e) {
      failed = true;
      console.error(e instanceof Error ? e.message : e);
    }
  }
  process.exitCode = failed ? 1 : 0;
}
