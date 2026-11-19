import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { ApiError } from '../../api/types';
import { createMemoryGardenApi } from '../../api/gardenApi';
import { getCrop } from '../../data/crops';
import { loadScenario, scenarioNames, SPEC_FILES, type LoadedScenario } from '../../solver/catalog';
import { checkExpectations } from '../../solver/check';
import type { Proposal } from '../../solver/proposal';
import { newPlantIds, solveFromText, tracePoints } from '../../solver/session';
import type { GardenPlan } from '../../types';
import { GardenProvider, useGarden } from '../state/gardenStore';
import { GardensProvider, useGardens } from '../state/gardensStore';
import { BedView } from './BedView';

// The dev-only solver viewer, reached at /_solver. It is only imported in development builds
// (see App.tsx), so none of this, nor the fixtures, ships.

const CURRENT = 'current-garden';
const DEFAULT_SPEC = JSON.stringify({ mode: 'fill', demands: [{ cropId: 'tomato', weight: 1 }, { cropId: 'lettuce', weight: 1 }] }, null, 2);

const muted: CSSProperties = { font: '400 12px Figtree', color: 'var(--color-neutral-700)' };
const card: CSSProperties = { background: 'var(--color-surface-raised)', borderRadius: 16, padding: 14 };
const button: CSSProperties = { font: '600 14px Figtree', padding: '8px 14px', borderRadius: 10, border: 'none', background: 'var(--color-accent)', color: 'white', cursor: 'pointer' };
const input: CSSProperties = { font: '400 14px Figtree', padding: '6px 8px', borderRadius: 8, border: '1px solid var(--color-neutral-400)', background: 'white' };

const newId = () => crypto.randomUUID();
const f3 = (n: number) => (Math.round(n * 1000) / 1000).toString();

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={card}>
      <h2 style={{ font: '700 15px Figtree', marginBottom: 8 }}>{title}</h2>
      {children}
    </section>
  );
}

function Errors({ errors }: { errors: ApiError[] }) {
  return (
    <ul role="alert" style={{ margin: 0, paddingLeft: 18, color: 'var(--color-accent-700)', font: '400 13px Figtree' }}>
      {errors.map((e, i) => (
        <li key={i}>
          <code>{e.code}</code> {e.message}
        </li>
      ))}
    </ul>
  );
}

/** The garden a solve ran on, and what it produced. */
interface Run {
  before: GardenPlan;
  rev: string;
  proposal: Proposal;
}

function Viewer({ initialSpec, scenario }: { initialSpec: string; scenario?: LoadedScenario }) {
  const { plan, rev, apply } = useGarden();
  const [specText, setSpecText] = useState(initialSpec);
  const [seed, setSeed] = useState(scenario?.options.seed ?? 1);
  const [iterations, setIterations] = useState(scenario?.options.iterations ?? 3000);
  const [run, setRun] = useState<Run | null>(null);
  const [errors, setErrors] = useState<ApiError[]>([]);
  const [applied, setApplied] = useState<string | null>(null);

  const solveNow = () => {
    setApplied(null);
    const out = solveFromText(plan, specText, { seed, iterations, trace: true });
    if (!out.ok) {
      setErrors(out.errors);
      setRun(null);
      return;
    }
    setErrors([]);
    setRun({ before: plan, rev, proposal: out.proposal });
  };

  const applyNow = () => {
    if (!run) return;
    const result = apply(run.proposal.commands, { ifRev: run.rev, scope: 'planting' });
    if (result.ok) setApplied(`Applied ${run.proposal.commands.length} commands.`);
    else {
      setErrors(result.errors);
      setApplied(result.errors.some((e) => e.code === 'stale_revision') ? 'The garden changed since this was solved; solve again.' : 'The garden refused the commands.');
    }
  };

  const p = run?.proposal;
  const outlined = useMemo(() => (run ? newPlantIds(run.before, run.proposal.plan) : new Set<string>()), [run]);
  const checks = useMemo(() => (run && scenario ? checkExpectations(run.before, run.proposal, scenario.expect) : null), [run, scenario]);
  const trace = p?.trace ? tracePoints(p.trace, 240, 60) : '';

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <Section title="Spec">
        <textarea
          aria-label="Spec (JSON)"
          value={specText}
          onChange={(e) => setSpecText(e.target.value)}
          spellCheck={false}
          style={{ ...input, width: '100%', minHeight: 150, fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
        />
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
          <label style={{ font: '600 13px Figtree' }}>
            Seed <input aria-label="Seed" type="number" value={seed} onChange={(e) => setSeed(Math.trunc(+e.target.value))} style={{ ...input, width: 90 }} />
          </label>
          <label style={{ font: '600 13px Figtree' }}>
            Iterations <input aria-label="Iterations" type="number" min={0} value={iterations} onChange={(e) => setIterations(Math.max(0, Math.trunc(+e.target.value)))} style={{ ...input, width: 100 }} />
          </label>
          <button type="button" style={button} onClick={solveNow}>
            Solve
          </button>
          <button type="button" style={{ ...button, background: 'var(--color-accent-2-700)', opacity: p && p.commands.length ? 1 : 0.45 }} disabled={!p || p.commands.length === 0} onClick={applyNow}>
            Apply to this garden
          </button>
          <span role="status" style={muted}>
            {applied}
          </span>
        </div>
        {errors.length > 0 && <Errors errors={errors} />}
      </Section>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
        <Section title={run ? 'Before' : 'This garden'}>
          <div data-panel="before" style={{ display: 'grid', gap: 12 }}>
            {(run ? run.before : plan).beds.map((bed) => (
              <BedView key={bed.id} bed={bed} plants={(run ? run.before : plan).plants.filter((q) => q.bedId === bed.id)} />
            ))}
          </div>
        </Section>
        <Section title="After">
          {p ? (
            <div data-panel="after" style={{ display: 'grid', gap: 12 }}>
              {p.plan.beds.map((bed) => (
                <BedView key={bed.id} bed={bed} plants={p.plan.plants.filter((q) => q.bedId === bed.id)} outlined={outlined} />
              ))}
            </div>
          ) : (
            <p style={muted}>Solve to see the proposal. New patches are outlined.</p>
          )}
        </Section>
      </div>

      {p && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
          {p.hardViolations.length > 0 && (
            <Section title="Hard violations (a solver bug)">
              <Errors errors={p.hardViolations} />
            </Section>
          )}
          <Section title="Crops">
            <table aria-label="Crops" style={{ borderCollapse: 'collapse', font: '400 13px Figtree', width: '100%' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th>Crop</th>
                  <th>Placed / target</th>
                  <th>Status</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {p.crops.map((c) => (
                  <tr key={c.cropId} data-crop-row={c.cropId}>
                    <td>{getCrop(c.cropId).name}</td>
                    <td>
                      {c.placed} / {c.target}
                    </td>
                    <td>{c.status}</td>
                    <td>{c.reasons.join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
          <Section title="Score">
            <table aria-label="Score" style={{ borderCollapse: 'collapse', font: '400 13px Figtree' }}>
              <tbody>
                {Object.entries(p.score).map(([k, v]) => (
                  <tr key={k} style={{ fontWeight: k === 'total' ? 700 : 400 }}>
                    <td style={{ paddingRight: 16 }}>{k}</td>
                    <td style={{ textAlign: 'right' }}>{f3(v)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {trace && (
              <svg viewBox="-2 -2 244 64" width={244} height={64} role="img" aria-label="Score over iterations" style={{ marginTop: 8 }}>
                <polyline points={trace} fill="none" stroke="var(--color-accent-2-700)" strokeWidth={1.5} />
              </svg>
            )}
          </Section>
          <Section title="Warnings">
            {p.introducedWarnings.length === 0 ? (
              <p style={muted}>The proposal introduces none{p.resolvedWarnings.length ? `, and resolves ${p.resolvedWarnings.length}` : ''}.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, font: '400 13px Figtree' }}>
                {p.introducedWarnings.map((w) => (
                  <li key={w.id}>
                    <b>{w.kind}</b> ({w.severity}) {w.message}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {checks && (
            <Section title="Scenario expectations">
              {checks.length === 0 ? <p style={muted}>All {scenario!.expect.length} hold.</p> : <Errors errors={checks.map((m) => ({ code: 'invalid_command', path: '', message: m }))} />}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

/** The user's own active garden, for the "current garden" source. */
function CurrentGarden({ initialSpec }: { initialSpec: string }) {
  const { activeGardenId } = useGardens();
  if (!activeGardenId) return null;
  return (
    <GardenProvider key={activeGardenId} gardenId={activeGardenId}>
      <Viewer initialSpec={initialSpec} />
    </GardenProvider>
  );
}

/** A scenario's garden, held in memory (nothing is saved), with the scenario's spec to start from. */
function ScenarioGarden({ name, nonce }: { name: string; nonce: number }) {
  // A new scenario, or Reset, builds a fresh garden and a fresh viewer.
  const scenario = useMemo(() => loadScenario(name), [name, nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  const api = useMemo(() => createMemoryGardenApi(scenario.plan, { newId }), [scenario]);
  const spec = JSON.stringify(SPEC_FILES[scenario.specName], null, 2);
  return (
    <GardenProvider key={`${name}:${nonce}`} gardenId={`solver-${name}`} api={api}>
      <Viewer initialSpec={spec} scenario={scenario} />
    </GardenProvider>
  );
}

export default function SolverPage() {
  const [source, setSource] = useState(scenarioNames()[0]);
  const [nonce, setNonce] = useState(0);
  return (
    <main data-testid="solver-viewer" style={{ maxWidth: 1240, margin: '0 auto', padding: '24px 20px 64px' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <h1 style={{ font: '700 26px Figtree' }}>Planting solver</h1>
        <span style={muted}>Development only. Pick a scenario, or the garden you are working on, edit the spec, and solve.</span>
        <label style={{ marginLeft: 'auto', font: '600 13px Figtree' }}>
          Garden{' '}
          <select
            aria-label="Scenario"
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setNonce((n) => n + 1);
            }}
            style={input}
          >
            {scenarioNames().map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
            <option value={CURRENT}>Current garden</option>
          </select>
        </label>
        <button type="button" style={{ ...button, background: 'var(--color-neutral-700)' }} onClick={() => setNonce((n) => n + 1)}>
          Reset
        </button>
      </header>
      {source === CURRENT ? (
        <GardensProvider key={nonce}>
          <CurrentGarden initialSpec={DEFAULT_SPEC} />
        </GardensProvider>
      ) : (
        <ScenarioGarden name={source} nonce={nonce} />
      )}
    </main>
  );
}
