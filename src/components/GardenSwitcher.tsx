import { useEffect, useRef, useState } from 'react';
import { useGarden } from '../state/gardenStore';
import { useGardens, readGardenName } from '../state/gardensStore';

export function GardenSwitcher({
  variant = 'compact',
  onEditSetup,
}: {
  variant?: 'compact' | 'title';
  onEditSetup?: () => void;
}) {
  const { gardenIds, activeGardenId, createGarden, removeGarden, switchGarden } = useGardens();
  // The active garden's name comes live from its own reducer state, not a localStorage
  // re-read — that read can briefly lag one render behind a just-made rename (the write
  // happens in an effect after the render that changed it).
  const { plan } = useGarden();
  const [open, setOpen] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmRemoveId(null);
      }
    }
    document.addEventListener('pointerdown', onDocPointerDown);
    return () => document.removeEventListener('pointerdown', onDocPointerDown);
  }, [open]);

  const activeName = plan.name;
  const isTitle = variant === 'title';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={
          isTitle
            ? {
                border: 'none',
                background: 'none',
                padding: '2px 6px',
                margin: '-2px -6px',
                borderRadius: 'var(--radius-sm)',
                font: '700 22px Figtree',
                color: 'var(--color-text)',
                transition: 'background 0.12s ease',
              }
            : {
                border: 'none',
                background: 'none',
                padding: '4px 2px',
                font: '500 12px Figtree',
                color: 'var(--color-text-muted)',
                textDecoration: 'underline',
                textDecorationColor: 'transparent',
                textUnderlineOffset: 3,
                transition: 'text-decoration-color 0.12s ease, color 0.12s ease',
              }
        }
        onMouseEnter={(e) => {
          if (isTitle) {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 6%, transparent)';
          } else {
            e.currentTarget.style.color = 'var(--color-text)';
            e.currentTarget.style.textDecorationColor = 'var(--color-divider)';
          }
        }}
        onMouseLeave={(e) => {
          if (isTitle) {
            e.currentTarget.style.background = 'none';
          } else {
            e.currentTarget.style.color = 'var(--color-text-muted)';
            e.currentTarget.style.textDecorationColor = 'transparent';
          }
        }}
      >
        {isTitle ? `${activeName} ▾` : gardenIds.length > 1 ? `${activeName} ▾` : 'My gardens'}
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            [isTitle ? 'left' : 'right']: 0,
            marginTop: 6,
            zIndex: 50,
            width: 260,
            background: 'var(--color-surface-raised)',
            border: '1.5px solid var(--color-text)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            padding: 6,
          }}
        >
          {onEditSetup && (
            <>
              <button
                onClick={() => {
                  onEditSetup();
                  setOpen(false);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 10px',
                  borderRadius: 'var(--radius-sm)',
                  border: 'none',
                  background: 'transparent',
                  font: '600 13px Figtree',
                  color: 'var(--color-text)',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 6%, transparent)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                ⚙ Edit setup
              </button>
              <div style={{ borderTop: '1.5px solid var(--color-divider)', margin: '4px 0' }} />
            </>
          )}

          {gardenIds.map((id) => (
            <GardenRow
              key={id}
              name={id === activeGardenId ? activeName : readGardenName(id)}
              active={id === activeGardenId}
              canRemove={gardenIds.length > 1}
              confirming={confirmRemoveId === id}
              onSwitch={() => {
                switchGarden(id);
                setOpen(false);
              }}
              onAskRemove={() => setConfirmRemoveId(id)}
              onCancelRemove={() => setConfirmRemoveId(null)}
              onConfirmRemove={() => {
                removeGarden(id);
                setConfirmRemoveId(null);
              }}
            />
          ))}

          <div style={{ borderTop: '1.5px solid var(--color-divider)', margin: '4px 0' }} />

          <button
            onClick={() => {
              createGarden();
              setOpen(false);
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              borderRadius: 'var(--radius-sm)',
              border: 'none',
              background: 'transparent',
              font: '600 13px Figtree',
              color: 'var(--color-accent-700)',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 6%, transparent)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            + New garden
          </button>
        </div>
      )}
    </div>
  );
}

function GardenRow({
  name,
  active,
  canRemove,
  confirming,
  onSwitch,
  onAskRemove,
  onCancelRemove,
  onConfirmRemove,
}: {
  name: string;
  active: boolean;
  canRemove: boolean;
  confirming: boolean;
  onSwitch: () => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onConfirmRemove: () => void;
}) {
  if (confirming) {
    return (
      <div style={{ padding: '8px 10px', borderRadius: 'var(--radius-sm)' }}>
        <p style={{ font: '400 12px/1.4 Figtree', color: 'var(--color-text-muted)', marginBottom: 6 }}>
          Delete &ldquo;{name}&rdquo;? This can&rsquo;t be undone.
        </p>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            onClick={onConfirmRemove}
            className="btn"
            style={{ padding: '4px 10px', font: '600 11.5px Figtree', color: 'var(--color-warning)', borderColor: 'var(--color-warning)' }}
          >
            Delete
          </button>
          <button onClick={onCancelRemove} className="btn btn-secondary" style={{ padding: '4px 10px', font: '600 11.5px Figtree' }}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        onClick={onSwitch}
        style={{
          flex: 1,
          textAlign: 'left',
          padding: '8px 10px',
          borderRadius: 'var(--radius-sm)',
          border: 'none',
          background: active ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'transparent',
          font: active ? '700 13px Figtree' : '500 13px Figtree',
          color: 'var(--color-text)',
        }}
        onMouseEnter={(e) => {
          if (!active) e.currentTarget.style.background = 'color-mix(in srgb, var(--color-text) 6%, transparent)';
        }}
        onMouseLeave={(e) => {
          if (!active) e.currentTarget.style.background = 'transparent';
        }}
      >
        {name}
      </button>
      {canRemove && (
        <button
          onClick={onAskRemove}
          aria-label={`Delete ${name}`}
          style={{
            border: 'none',
            background: 'none',
            padding: '4px 8px',
            font: '400 13px Figtree',
            color: 'var(--color-text-muted)',
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
