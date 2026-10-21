import { useState } from 'react';
import { useGarden } from '../state/gardenStore';
import { gardenBounds } from '../../core/layout';
import { PlantingView } from '../planting/PlantingView';
import { PlantingCalendar } from './PlantingCalendar';
import { GardenSwitcher } from './GardenSwitcher';
import { LayoutEditor } from './LayoutEditor';
import { Icon } from './Icon';

export function BedCanvas({ onEditSetup }: { onEditSetup: () => void }) {
  const { plan } = useGarden();
  const { beds, plants, profile } = plan;
  const [mode, setMode] = useState<'plant' | 'layout'>('plant');
  const [view, setView] = useState<'bed' | 'calendar'>('bed');
  const bounds = gardenBounds(beds);

  function toggleLayout() {
    setMode((m) => (m === 'plant' ? 'layout' : 'plant'));
    setView('bed');
  }

  const isLayout = mode === 'layout';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100svh' }}>
      {/* The header casts a shadow onto the full-bleed canvas below it. */}
      <header
        style={{
          position: 'relative',
          zIndex: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          padding: '12px 24px',
          background: 'var(--color-bg)',
          boxShadow: 'var(--shadow-md)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <GardenSwitcher variant="title" onEditSetup={onEditSetup} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <p style={{ font: '400 13px Figtree', color: 'var(--color-text-muted)' }}>
              {beds.length} {beds.length === 1 ? 'bed' : 'beds'} · {profile.sunExposure.replace('-', ' ')}
            </p>
            {!isLayout && <HelpTip text="Pick a plant on the left, then click or paint in a bed. Drag outside the beds to pan; pinch, ⌘/Ctrl-scroll or +/− to zoom; 0 to fit." />}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {isLayout ? (
            <>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  font: '500 13px Figtree',
                  color: 'var(--color-accent-700)',
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-accent)' }} />
                Editing layout
              </span>
              <button onClick={toggleLayout} className="btn btn-primary" style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}>
                <Icon name="check" size={15} />
                Done
              </button>
            </>
          ) : (
            <>
              <button onClick={toggleLayout} className="btn btn-secondary" style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}>
                <Icon name="ruler" size={15} />
                Edit layout
              </button>
              <ViewTab label="Bed layout" active={view === 'bed'} onClick={() => setView('bed')} />
              <ViewTab label="Planting calendar" active={view === 'calendar'} onClick={() => setView('calendar')} />
            </>
          )}
        </div>
      </header>

      {isLayout && <LayoutEditor />}

      {!isLayout && view === 'calendar' && (
        <div style={{ padding: '24px' }}>
          <PlantingCalendar plants={plants} zoneId={profile.zoneId} />
        </div>
      )}

      {!isLayout && view === 'bed' && !bounds && (
        <div style={{ padding: '24px' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-start',
              gap: 12,
              padding: '28px 24px',
              borderRadius: 'var(--radius-lg)',
              border: '1.5px dashed var(--color-divider)',
            }}
          >
            <p style={{ font: '400 17px Caveat, cursive', color: '#9a8c76' }}>No beds yet — add one to start planting.</p>
            <button onClick={toggleLayout} className="btn btn-primary" style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}>
              <Icon name="ruler" size={15} />
              Edit layout
            </button>
          </div>
        </div>
      )}

      {!isLayout && view === 'bed' && bounds && <PlantingView />}
    </div>
  );
}

function HelpTip({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        width: 15,
        height: 15,
        borderRadius: '999px',
        border: '1.5px solid var(--color-text-muted)',
        color: 'var(--color-text-muted)',
        font: '600 10px Figtree',
        cursor: 'help',
      }}
    >
      ?
    </span>
  );
}

function ViewTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={active ? 'btn btn-primary' : 'btn btn-secondary'}
      style={{ padding: '8px 14px', font: '600 12.5px Figtree' }}
    >
      {label}
    </button>
  );
}
