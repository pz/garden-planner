// The solver's command line: `npm run solve -- <scenario>…`, `--all` or `--list`. Runs under Node
// via tsx, so unlike the rest of src/solver it may use Node APIs (hence the `.node.ts` name, which
// tsconfig.core.json leaves to tsconfig.node.json).
import { readLayout } from '../api/layoutView';
import { getCrop } from '../data/crops';
import type { GardenPlan } from '../types';
import { gardenNames, loadScenario, scenarioNames } from './catalog';
import type { Proposal } from './proposal';
import { solve } from './solve';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const value = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VALUE_FLAGS = ['seed', 'iterations'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(argv[i - 1]?.slice(2) ?? ''));

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();

function asciiBeds(plan: GardenPlan): string[] {
  const r = readLayout(plan);
  if (!r.ok) return [r.errors.map((e) => e.message).join('; ')];
  return r.layout.beds.flatMap((b) => [`  ${b.name} (${b.id}, ${b.widthIn}×${b.heightIn} in, ${b.shape})`, ...b.grid.lines.map((l) => `    ${l}`)]);
}

function report(name: string, before: GardenPlan, p: Proposal, ms: number): string {
  const lines: string[] = [`=== ${name} (seed ${p.seed}, ${p.iterations} iterations, ${ms} ms) ===`, 'Before:', ...asciiBeds(before), 'After:', ...asciiBeds(p.plan)];
  lines.push('Crops:');
  for (const c of p.crops) lines.push(`  ${getCrop(c.cropId).name.padEnd(14)} ${String(c.placed).padStart(4)} / ${String(c.target).padEnd(4)} ${c.status}${c.reasons.length ? ` (${c.reasons.join(', ')})` : ''}`);
  lines.push('Score: ' + Object.entries(p.score).map(([k, v]) => `${k} ${f(v)}`).join(', '));
  lines.push(`Commands: ${p.commands.length}; introduced warnings: ${p.introducedWarnings.length ? p.introducedWarnings.map((w) => `${w.kind}/${w.severity}`).join(', ') : 'none'}`);
  if (p.hardViolations.length) lines.push('HARD VIOLATIONS:', ...p.hardViolations.map((e) => `  ${e.code} ${e.path} ${e.message}`));
  return lines.join('\n');
}

if (flag('list') || (positional.length === 0 && !flag('all'))) {
  console.log(`Gardens:   ${gardenNames().join(', ')}\nScenarios: ${scenarioNames().join(', ')}\n\nUsage: npm run solve -- <scenario>… | --all [--seed N] [--iterations N] [--json]`);
} else {
  const names = flag('all') ? scenarioNames() : positional;
  const failed: string[] = [];
  for (const name of names) {
    try {
      const s = loadScenario(name);
      const seed = value('seed') !== undefined ? Number(value('seed')) : s.options.seed;
      const iterations = value('iterations') !== undefined ? Number(value('iterations')) : s.options.iterations;
      const t0 = Date.now();
      const p = solve(s.plan, s.spec, { seed, iterations, year: 2026 });
      const ms = Date.now() - t0;
      console.log(flag('json') ? JSON.stringify(p, null, 2) : report(name, s.plan, p, ms) + '\n');
      if (p.hardViolations.length) failed.push(name);
    } catch (e) {
      failed.push(name);
      console.error(e instanceof Error ? e.stack : e);
    }
  }
  process.exitCode = failed.length ? 1 : 0;
}
