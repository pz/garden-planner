import { useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { MOD } from './keys';

const pill = {
  background: 'var(--color-bg)',
  boxShadow: 'var(--shadow-md)',
} as const;

/** The pill at the top centre while planting or duplicating: what's armed, a hint, and Done. */
export function ModeChip({ icon, name, hint, onDone }: { icon: ReactNode; name: string; hint: string; onDone: () => void }) {
  return (
    <div
      role="status"
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 3, display: 'flex', alignItems: 'center', gap: 10, padding: '5px 5px 5px 8px', borderRadius: 999, font: '400 14px Figtree', whiteSpace: 'nowrap', ...pill }}
    >
      <span style={{ flex: 'none', width: 30, height: 30, display: 'grid', placeItems: 'center' }}>{icon}</span>
      <span>
        <b style={{ fontWeight: 600 }}>{name}</b>
        <span style={{ color: 'var(--color-neutral-700)' }}> · {hint}</span>
      </span>
      <button type="button" className="btn btn-secondary" style={{ padding: '5px 14px', font: '600 13px Figtree' }} onClick={onDone}>
        Done
      </button>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Click', 'Select patch'], ['Click again', 'One plant'], [`${MOD}click`, 'Add to selection'], ['Drag in bed', 'Select area'],
  ['Drag outside beds', 'Pan'], [`${MOD}scroll`, 'Zoom'], ['0', 'Fit'], ['Alt + drag', 'Copy'],
  [`${MOD}D`, 'Duplicate'], [`${MOD}G`, 'Group'], [`⇧${MOD}G`, 'Ungroup'], ['Del', 'Delete'],
  ['Right-click', 'More'], ['Esc', 'Done planting'], [`${MOD}Z`, 'Undo'],
];

const HELP_KEY = 'planting-help-min';
function readMin(): boolean {
  try {
    return localStorage.getItem(HELP_KEY) === '1';
  } catch {
    return false;
  }
}

/** The tip for what's happening now, and the shortcuts; collapses to a small pill (remembered). */
export function HelpBox({ tip }: { tip: string }) {
  const [min, setMin] = useState(readMin);
  const set = (m: boolean) => {
    setMin(m);
    try {
      localStorage.setItem(HELP_KEY, m ? '1' : '');
    } catch {
      /* private mode: just don't remember it */
    }
  };
  const base = { position: 'absolute', left: 96, bottom: 16, zIndex: 3, ...pill } as const;
  if (min) {
    return (
      <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => set(false)} style={{ ...base, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', border: 'none', borderRadius: 999, font: '600 13px Figtree', cursor: 'pointer', color: 'var(--color-text)' }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', border: '1.5px solid currentColor', display: 'grid', placeItems: 'center', font: '700 11px Figtree' }}>?</span>
        Shortcuts
      </button>
    );
  }
  return (
    <div onPointerDown={(e) => e.stopPropagation()} style={{ ...base, width: 'min(620px, calc(100% - 128px - 320px))', minWidth: 360, padding: '16px 18px', borderRadius: 28, background: 'var(--color-bg)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, font: '400 14px/1.4 Figtree' }}>
        <span>{tip}</span>
        <button type="button" onClick={() => set(true)} style={{ border: 'none', background: 'none', padding: 0, font: '600 13px Figtree', color: 'var(--color-accent-700)', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Hide shortcuts
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', marginTop: 12 }}>
        {SHORTCUTS.map(([k, d]) => (
          <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: '400 12.5px Figtree', color: 'var(--color-neutral-700)' }}>
            <kbd style={{ font: '600 12.5px Figtree', color: 'var(--color-text)', background: 'var(--color-surface)', borderRadius: 999, padding: '2px 9px' }}>{k}</kbd>
            {d}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  hint?: string;
  icon: ReactNode;
  onClick: () => void;
}

/** A small popup menu at a point in the canvas. */
export function ContextMenu({ at, size, title, items }: { at: { x: number; y: number }; size: { w: number; h: number }; title?: string; items: MenuItem[] }) {
  const w = 230;
  const h = (title ? 34 : 0) + items.length * 38 + 12;
  return (
    <div
      role="menu"
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      style={{ position: 'absolute', zIndex: 7, left: Math.max(8, Math.min(at.x, size.w - w - 8)), top: Math.max(8, Math.min(at.y, size.h - h - 8)), width: w, padding: 6, borderRadius: 18, background: 'var(--color-surface-raised, var(--color-bg))', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--color-divider)' }}
    >
      {title && <div style={{ padding: '6px 10px', font: '600 12px Figtree', color: 'var(--color-neutral-700)' }}>{title}</div>}
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          onClick={it.onClick}
          style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 38, padding: '0 10px', border: 'none', borderRadius: 12, background: 'transparent', font: '400 14px Figtree', color: 'var(--color-text)', cursor: 'pointer', textAlign: 'left' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 7%, transparent)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <span style={{ width: 22, display: 'grid', placeItems: 'center' }}>{it.icon}</span>
          <span style={{ flex: 1 }}>{it.label}</span>
          {it.hint && <span style={{ font: '400 12px Figtree', color: 'var(--color-neutral-700)' }}>{it.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** −, the zoom level (click to fit), +, and fit. */
export function ZoomControls({ percent, onZoomOut, onZoomIn, onFit }: { percent: number; onZoomOut: () => void; onZoomIn: () => void; onFit: () => void }) {
  const round = { width: 32, height: 32, padding: 0, justifyContent: 'center', borderRadius: 999, borderColor: 'transparent' } as const;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, padding: 4, borderRadius: 999, ...pill }}>
      <button className="btn btn-secondary" title="Zoom out (−)" aria-label="Zoom out" onClick={onZoomOut} style={round}>
        <Icon name="minus" size={16} />
      </button>
      <button className="btn btn-secondary" title="Fit garden (0)" aria-label="Fit garden" onClick={onFit} style={{ borderColor: 'transparent', minWidth: 58, padding: '6px 8px', font: '600 13px Figtree' }}>
        {percent}%
      </button>
      <button className="btn btn-secondary" title="Zoom in (+)" aria-label="Zoom in" onClick={onZoomIn} style={round}>
        <Icon name="plus" size={16} />
      </button>
      <button className="btn btn-secondary" title="Fit garden (0)" aria-label="Fit garden to view" onClick={onFit} style={round}>
        <Icon name="fit" size={16} />
      </button>
    </div>
  );
}
