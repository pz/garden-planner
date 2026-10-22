import { useState, type ReactNode } from 'react';
import type { CropDef } from '../../types';
import { Icon, type IconName } from '../components/Icon';
import { PlantMark } from '../components/PlantMark';
import { formatLength } from '../layoutInteraction';
import { FAMILIES } from '../families';
import { storageKey } from '../state/storageNamespace';
import { MOD } from './keys';

const PINNED_KEY = storageKey('planting-panel-pinned');

function readPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) === '1';
  } catch {
    return false;
  }
}

const COLLAPSED_W = 64;
const EXPANDED_W = 256;

/** A full-width pill button in the panel: an icon, and (once the panel is open) a label. */
function Row({ label, aria, hint, active, disabled, open, onClick, children, height = 48 }: {
  label: string;
  /** The accessible name, when it should say more than the label. */
  aria?: string;
  hint?: string;
  active?: boolean;
  disabled?: boolean;
  open: boolean;
  onClick: () => void;
  children: ReactNode;
  height?: number;
}) {
  return (
    <button
      type="button"
      aria-label={aria ?? label}
      aria-pressed={active}
      disabled={disabled}
      title={open ? undefined : hint ? `${label} (${hint})` : label}
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        height,
        flex: 'none',
        padding: '0 12px 0 15px',
        border: 'none',
        borderRadius: 999,
        background: active ? 'var(--color-accent)' : 'transparent',
        color: active ? 'var(--color-bg)' : 'var(--color-text)',
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? 'default' : 'pointer',
        font: '600 14px Figtree',
        whiteSpace: 'nowrap',
        textAlign: 'left',
      }}
    >
      {children}
      {open && <span style={{ flex: 1 }}>{label}</span>}
      {open && hint && <span style={{ font: '400 12px Figtree', opacity: 0.7 }}>{hint}</span>}
    </button>
  );
}

/**
 * The plant list: a slim icon column that opens on hover to show names and spacing. Picking a
 * plant arms planting with it (picking the armed one again puts it down).
 */
export function PlantPanel({
  crops,
  armedId,
  selecting,
  canUndo,
  onSelect,
  onUndo,
  onArm,
  onAdd,
  onEdit,
}: {
  crops: CropDef[];
  armedId: string | null;
  selecting: boolean;
  canUndo: boolean;
  onSelect: () => void;
  onUndo: () => void;
  onArm: (cropId: string) => void;
  /** Opens the add-a-plant dialog, with a name to start from when searching found nothing. */
  onAdd: (name?: string) => void;
  onEdit: (cropId: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const [query, setQuery] = useState('');
  const [pinned, setPinned] = useState(readPinned);
  const open = hover || pinned;
  const togglePin = () => {
    const next = !pinned;
    setPinned(next);
    try {
      localStorage.setItem(PINNED_KEY, next ? '1' : '');
    } catch {
      /* the choice just won't stick */
    }
  };
  const q = query.trim().toLowerCase();
  const groups = FAMILIES.map(({ family, label }) => ({
    label,
    crops: crops.filter((c) => c.family === family && (!q || c.name.toLowerCase().includes(q))),
  })).filter((g) => g.crops.length > 0);

  return (
    <aside
      aria-label="Plants"
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: 'absolute',
        left: 16,
        top: 16,
        bottom: 16,
        zIndex: 4,
        width: open ? EXPANDED_W : COLLAPSED_W,
        transition: 'width 160ms ease',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderRadius: 28,
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: 8, background: 'var(--color-bg)' }}>
        <Row label="Select" hint="V" active={selecting} open={open} onClick={onSelect}>
          <Icon name="select" size={18} />
        </Row>
        <Row label="Undo" aria="Undo last change" hint={`${MOD}Z`} disabled={!canUndo} open={open} onClick={onUndo}>
          <Icon name="undo" size={18} />
        </Row>
        <Row label={pinned ? 'Unpin list' : 'Keep list open'} aria="Keep plant list open" active={pinned} open={open} height={34} onClick={togglePin}>
          <Icon name="pin" size={16} />
        </Row>
      </div>

      <div style={{ flex: 'none', height: 56, display: 'flex', alignItems: 'center', padding: '0 8px' }}>
        {open ? (
          <input
            className="input"
            placeholder="Search plants"
            aria-label="Search plants"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ background: 'var(--color-bg)' }}
          />
        ) : (
          <span style={{ width: 48, display: 'grid', placeItems: 'center', color: 'var(--color-neutral-600)' }}>
            <Icon name="search" size={18} />
          </span>
        )}
      </div>

      <div style={{ flex: 'none', padding: '0 8px 6px' }}>
        <Row label={q && groups.length === 0 ? `Add “${query.trim()}” as a plant` : 'Add your own plant'} aria="Add your own plant" open={open} height={34} onClick={() => onAdd(q && groups.length === 0 ? query.trim() : undefined)}>
          <Icon name="plus" size={16} />
        </Row>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', overflowX: 'hidden', scrollbarWidth: 'none', padding: '0 8px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {groups.map((g) => (
          <div key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div style={{ height: 20, display: 'flex', alignItems: 'center', padding: '0 10px' }}>
              {open ? (
                <span style={{ font: '600 13px Figtree', color: 'var(--color-neutral-700)', whiteSpace: 'nowrap' }}>{g.label}</span>
              ) : (
                <span style={{ width: 28, height: 2, borderRadius: 2, background: 'var(--color-neutral-400)' }} />
              )}
            </div>
            {g.crops.map((c) => {
              const on = armedId === c.id;
              return (
                <div key={c.id} style={{ position: 'relative', display: 'flex', flex: 'none' }}>
                <button
                  type="button"
                  aria-label={c.name}
                  aria-pressed={on}
                  onClick={() => onArm(c.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    flex: 1,
                    height: 44,
                    padding: c.look ? '0 44px 0 9px' : '0 12px 0 9px',
                    border: 'none',
                    borderRadius: 999,
                    background: on ? 'var(--color-accent-200)' : 'transparent',
                    color: 'var(--color-text)',
                    font: `${on ? 600 : 400} 14px Figtree`,
                    whiteSpace: 'nowrap',
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <PlantMark cropId={c.id} diameter={30} />
                  {open && <span style={{ flex: 1 }}>{c.name}</span>}
                  {open && <span style={{ font: '400 12px Figtree', color: 'var(--color-neutral-700)' }}>{formatLength(c.spacingIn)}</span>}
                </button>
                {open && c.look && (
                  <button type="button" aria-label={`Edit ${c.name}`} title="Edit plant" onClick={() => onEdit(c.id)} style={{ position: 'absolute', right: 6, top: 6, width: 32, height: 32, display: 'grid', placeItems: 'center', border: 'none', borderRadius: 999, background: 'transparent', color: 'var(--color-neutral-700)', cursor: 'pointer' }}>
                    <Icon name="pencil" size={15} />
                  </button>
                )}
                </div>
              );
            })}
          </div>
        ))}
        {groups.length === 0 && open && !q && <span style={{ padding: '4px 12px', font: '400 13px Figtree', color: 'var(--color-neutral-700)' }}>No plants match</span>}
      </div>
    </aside>
  );
}

export type { IconName };
