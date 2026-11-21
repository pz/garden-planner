import { getCrop } from '../../data/crops';
import type { Suggestion } from '../../solver/suggestion';
import { PlantMark } from '../components/PlantMark';
import { CardFrame } from './CropsCard';

const percent = (share: number) => `${Math.round(share * 100)}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');

/**
 * The card while a suggestion is on the canvas: what would change, crop by crop, and the three
 * ways out. Nothing is applied until Apply; Discard goes back to the request as it was.
 */
export function SuggestionCard({
  scopeName,
  suggestion,
  plantsBefore,
  onApply,
  onTryAgain,
  onDiscard,
}: {
  /** The bed's name, or null for the whole garden. */
  scopeName: string | null;
  suggestion: Suggestion;
  plantsBefore: number;
  onApply: () => void;
  onTryAgain: () => void;
  onDiscard: () => void;
}) {
  const plantsAfter = plantsBefore + suggestion.adds.length - suggestion.removed.length;
  const net = plantsAfter - plantsBefore;
  const nothing = suggestion.commands.length === 0;
  return (
    <CardFrame label="Suggestion">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', background: 'var(--color-bg)' }}>
        <span aria-label={`${signed(net)} plants`} style={{ display: 'grid', placeItems: 'center', minWidth: 40, height: 40, padding: '0 6px', borderRadius: 999, background: net === 0 ? 'var(--color-neutral-300)' : 'var(--color-accent)', color: net === 0 ? 'var(--color-text)' : 'var(--color-bg)', font: '700 16px Figtree' }}>
          {signed(net)}
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <h2 style={{ font: '700 19px Figtree', margin: 0 }}>{scopeName ?? 'Garden'}</h2>
          <span style={{ font: '400 12.5px Figtree', color: 'var(--color-neutral-700)' }}>
            {plantsBefore} → {plantsAfter} plants · {percent(suggestion.fullness.after)} full
          </span>
        </div>
      </div>

      <div style={{ padding: '12px 16px 6px', display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto', minHeight: 0 }}>
        <span style={{ font: '700 11px Figtree', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-neutral-700)' }}>Suggested · not applied yet</span>
        <ul aria-label="Changes" style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {suggestion.rows.map((r) => (
            <li key={r.cropId} data-suggestion-row={r.cropId} style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: '600 14px Figtree' }}>
                <PlantMark cropId={r.cropId} diameter={22} />
                <span style={{ flex: 1 }}>{getCrop(r.cropId).name}</span>
                <span style={{ font: '400 13px Figtree', color: 'var(--color-neutral-700)' }}>
                  {r.before} → {r.after}
                </span>
                <span style={{ minWidth: 30, textAlign: 'center', font: '700 12px Figtree', borderRadius: 999, padding: '2px 8px', background: r.after === r.before ? 'var(--color-neutral-300)' : r.after > r.before ? 'var(--color-accent-2-200)' : 'var(--color-accent-200)' }}>{signed(r.after - r.before)}</span>
              </div>
              {r.note && <span style={{ marginLeft: 30, font: '400 12px Figtree', color: 'var(--color-warning)' }}>{r.note[0].toUpperCase() + r.note.slice(1)}.</span>}
            </li>
          ))}
        </ul>
        <p style={{ margin: 0, font: '400 13px/1.45 Figtree', color: 'var(--color-text-muted)' }}>{suggestion.reasoning}</p>
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 14px 14px', borderTop: '1px solid var(--color-divider)' }}>
        <button type="button" className="btn btn-ghost" onClick={onDiscard} title="Discard (Esc)">
          Discard
        </button>
        <button type="button" className="btn btn-secondary" onClick={onTryAgain} style={{ flex: 1, justifyContent: 'center' }}>
          Try again
        </button>
        <button type="button" className="btn btn-primary" onClick={onApply} disabled={nothing} style={{ flex: 1, justifyContent: 'center', opacity: nothing ? 0.5 : 1 }}>
          Apply
        </button>
      </div>
    </CardFrame>
  );
}
