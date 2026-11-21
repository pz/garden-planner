import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AdjustRow } from '../../core/adjust';
import type { CropDef } from '../../types';
import { getCrop } from '../../data/crops';
import { Icon } from '../components/Icon';
import { PlantMark } from '../components/PlantMark';

/** The card's frame: the same place, width and look as the selection panel it stands in for. */
export function CardFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside
      aria-label={label}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        right: 16,
        top: 16,
        maxHeight: 'calc(100% - 96px)',
        width: 300,
        zIndex: 4,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 28,
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {children}
    </aside>
  );
}

const tint = 'color-mix(in srgb, var(--color-accent) 12%, transparent)';

const iconButton = (on: boolean, disabled?: boolean) => ({
  display: 'grid',
  placeItems: 'center',
  width: 26,
  height: 26,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: on ? 'var(--color-accent)' : 'transparent',
  color: on ? 'var(--color-bg)' : 'var(--color-neutral-700)',
  opacity: disabled ? 0.3 : 1,
  cursor: disabled ? 'default' : 'pointer',
});

function CropRow({
  row,
  onArrow,
  onType,
  onClear,
  onPick,
}: {
  row: AdjustRow;
  onArrow: (dir: 'more' | 'fewer') => void;
  onType: (text: string) => void;
  onClear: () => void;
  onPick: () => void;
}) {
  const { count, request } = row;
  const name = getCrop(row.cropId).name;
  const [hot, setHot] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const exact = request?.kind === 'exact' ? request.target : null;
  const shown = exact ?? count;
  const text = draft ?? String(shown);
  const show = hot || draft !== null || exact !== null || request !== undefined;

  const commit = () => {
    if (draft !== null && draft !== String(shown)) onType(draft);
    setDraft(null);
  };

  return (
    <li
      data-crop-row={row.cropId}
      data-request={request?.kind}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setHot(false);
          commit();
        }
      }}
      style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 40, padding: '2px 8px 2px 10px', borderRadius: 14, background: request ? tint : hot ? 'color-mix(in srgb, var(--color-text) 5%, transparent)' : 'transparent', listStyle: 'none' }}
    >
      <button type="button" onClick={onPick} title={`Select ${name.toLowerCase()}`} aria-label={`Select ${name}`} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0, border: 'none', background: 'none', padding: 0, textAlign: 'left', font: '600 14px Figtree', color: 'var(--color-text)' }}>
        <PlantMark cropId={row.cropId} diameter={24} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
        {row.isNew && <span style={{ font: '700 10.5px Figtree', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--color-accent-700)', background: 'var(--color-accent-100)', borderRadius: 999, padding: '2px 7px' }}>new</span>}
      </button>

      <div role="group" aria-label={`${name} request`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {show && !(count === 0 && exact === null) && (
          <button type="button" aria-label={`Fewer ${name}`} aria-pressed={request?.kind === 'fewer'} onClick={() => onArrow('fewer')} style={iconButton(request?.kind === 'fewer')}>
            <Icon name="arrowDown" size={14} />
          </button>
        )}
        {exact !== null && <span aria-hidden="true" style={{ font: '400 13px Figtree', color: 'var(--color-neutral-700)' }}>{count} →</span>}
        {show ? (
          <input
            aria-label={`${name} ${exact !== null ? 'target' : 'count'}`}
            inputMode="numeric"
            value={text}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commit();
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setDraft(null);
                e.currentTarget.blur();
                e.stopPropagation();
              } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                setDraft(null);
                onArrow(e.key === 'ArrowUp' ? 'more' : 'fewer');
              }
            }}
            style={{ width: 40, height: 26, border: exact !== null ? '1.5px solid var(--color-accent)' : '1.5px solid transparent', borderRadius: 999, background: exact !== null ? 'var(--color-bg)' : 'transparent', textAlign: 'center', font: `${exact !== null ? 700 : 600} 13.5px Figtree`, color: 'var(--color-text)', padding: 0 }}
          />
        ) : (
          <span style={{ minWidth: 40, textAlign: 'center', font: '600 13.5px Figtree', color: 'var(--color-neutral-700)' }}>{count}</span>
        )}
        {show && (
          <button type="button" aria-label={`More ${name}`} aria-pressed={request?.kind === 'more'} onClick={() => onArrow('more')} style={iconButton(request?.kind === 'more')}>
            <Icon name="arrowUp" size={14} />
          </button>
        )}
        {request && (
          <button type="button" aria-label={row.isNew ? `Remove ${name} from the request` : `Clear request for ${name}`} onClick={onClear} style={iconButton(false)}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
    </li>
  );
}

function AddCrop({ crops, taken, onAdd }: { crops: CropDef[]; taken: ReadonlySet<string>; onAdd: (cropId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const matches = crops.filter((c) => !taken.has(c.id) && c.name.toLowerCase().includes(q.trim().toLowerCase()));

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: '6px 10px', font: '600 13.5px Figtree', color: 'var(--color-accent-700)' }}>
        <Icon name="plus" size={15} /> Add a crop
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 4px 0' }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          ref={input}
          className="input"
          aria-label="Search crops to add"
          placeholder="Search crops"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setOpen(false);
              setQ('');
            } else if (e.key === 'Enter' && matches[0]) {
              onAdd(matches[0].id);
              setOpen(false);
              setQ('');
            }
          }}
          style={{ background: 'var(--color-bg)', padding: '6px 12px', font: '400 13.5px Figtree' }}
        />
        <button type="button" aria-label="Cancel adding a crop" onClick={() => { setOpen(false); setQ(''); }} style={iconButton(false)}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <ul role="listbox" aria-label="Crops to add" style={{ margin: 0, padding: 0, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {matches.length === 0 && <li style={{ listStyle: 'none', padding: '6px 10px', font: '400 13px Figtree', color: 'var(--color-neutral-700)' }}>No crop matches.</li>}
        {matches.map((c) => (
          <li key={c.id} role="option" aria-selected="false" style={{ listStyle: 'none' }}>
            <button type="button" onClick={() => { onAdd(c.id); setOpen(false); setQ(''); }} style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', border: 'none', background: 'none', padding: '5px 10px', borderRadius: 10, textAlign: 'left', font: '500 13.5px Figtree', color: 'var(--color-text)' }}>
              <PlantMark cropId={c.id} diameter={22} />
              {c.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The info card with nothing selected: the garden (or one bed) and its crops, each with a count
 * that is also where a gardener asks for more, fewer or an exact number, and the button that asks
 * for a suggestion. The card holds no state of its own about the request; it draws the rows it is
 * given and reports what was pressed.
 */
export function CropsCard({
  title,
  subtitle,
  scoped,
  rows,
  changes,
  crops,
  onBack,
  onArrow,
  onType,
  onClear,
  onAdd,
  onReset,
  onPick,
  onSuggest,
}: {
  title: string;
  subtitle: string;
  /** One bed rather than the whole garden. */
  scoped: boolean;
  rows: AdjustRow[];
  changes: number;
  crops: CropDef[];
  onBack: () => void;
  onArrow: (row: AdjustRow, dir: 'more' | 'fewer') => void;
  onType: (row: AdjustRow, text: string) => void;
  onClear: (row: AdjustRow) => void;
  onAdd: (cropId: string) => void;
  onReset: () => void;
  onPick: (row: AdjustRow) => void;
  onSuggest: () => void;
}) {
  const taken = new Set(rows.map((r) => r.cropId));
  return (
    <CardFrame label="Crops">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', background: 'var(--color-bg)' }}>
        {scoped && (
          <button type="button" onClick={onBack} aria-label="Back to the garden" title="Back to the garden (Esc)" style={{ border: 'none', background: 'none', padding: 4, color: 'var(--color-text)', display: 'flex' }}>
            <Icon name="back" size={18} />
          </button>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
          <h2 style={{ font: '700 19px Figtree', margin: 0 }}>{title}</h2>
          <span style={{ font: '400 12.5px Figtree', color: 'var(--color-neutral-700)' }}>{subtitle}</span>
        </div>
      </div>

      <div style={{ padding: '12px 10px 6px', display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px 2px' }}>
          <span style={{ font: '700 11px Figtree', letterSpacing: '0.07em', textTransform: 'uppercase', color: 'var(--color-neutral-700)' }}>{scoped ? `Crops in ${title}` : 'Crops'}</span>
          {changes > 0 && (
            <button type="button" onClick={onReset} style={{ border: 'none', background: 'none', padding: 0, font: '600 12px Figtree', color: 'var(--color-accent-700)', textDecoration: 'underline' }}>
              Reset
            </button>
          )}
        </div>
        {rows.length === 0 && <p style={{ margin: '4px 8px', font: '400 13px/1.45 Figtree', color: 'var(--color-neutral-700)' }}>Nothing is planted {scoped ? 'in this bed' : 'yet'}. Add a crop to ask for some.</p>}
        <ul aria-label={scoped ? `Crops in ${title}` : 'Crops in the garden'} style={{ margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {rows.map((r) => (
            <CropRow key={r.cropId} row={r} onArrow={(d) => onArrow(r, d)} onType={(t) => onType(r, t)} onClear={() => onClear(r)} onPick={() => onPick(r)} />
          ))}
        </ul>
        <AddCrop crops={crops} taken={taken} onAdd={onAdd} />
      </div>

      {changes > 0 && (
        <div style={{ padding: '10px 14px 14px', borderTop: '1px solid var(--color-divider)' }}>
          <button type="button" className="btn btn-primary" onClick={onSuggest} style={{ width: '100%', justifyContent: 'center' }}>
            Suggest for {scoped ? title : 'the garden'} · {changes} {changes === 1 ? 'change' : 'changes'}
          </button>
        </div>
      )}
    </CardFrame>
  );
}
