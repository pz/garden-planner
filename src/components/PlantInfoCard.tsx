import { useState } from 'react';
import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { getZone } from '../data/zones';
import { formatDate, scheduleFor } from '../utils/dates';
import { CROP_COLORS, PlantMark } from './PlantMark';

export function PlantInfoCard({
  plant,
  zoneId,
  warned,
  groupCount,
  onClose,
  onSetVariety,
  onRemove,
  onRemoveGroup,
  onDismissWarning,
}: {
  plant: PlantInstance;
  zoneId: string;
  warned: boolean;
  groupCount: number;
  onClose: () => void;
  onSetVariety: (variety: string | undefined) => void;
  onRemove: () => void;
  onRemoveGroup: () => void;
  onDismissWarning: () => void;
}) {
  const crop = getCrop(plant.cropId);
  const zone = getZone(zoneId);
  const schedule = scheduleFor(crop, zone, new Date().getFullYear());
  const [variety, setVariety] = useState(plant.variety ?? '');

  return (
    <div
      style={{
        position: 'fixed',
        right: 20,
        top: 20,
        bottom: 20,
        width: 320,
        background: 'var(--color-surface-raised)',
        border: '2px solid var(--color-text)',
        borderRadius: 'var(--radius-lg)',
        boxShadow: 'var(--shadow-lg)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        zIndex: 40,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '14px 16px',
          borderBottom: '1.5px solid var(--color-divider)',
        }}
      >
        <PlantMark family={crop.family} color={CROP_COLORS[crop.id]} diameter={30} />
        <div style={{ flex: 1 }}>
          <div style={{ font: '700 15px Figtree' }}>{crop.name}</div>
          <div style={{ font: '400 11px Figtree', color: 'var(--color-text-muted)', textTransform: 'capitalize' }}>
            {crop.family}
            {groupCount > 1 ? ` · patch of ${groupCount}` : ''}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ border: 'none', background: 'none', font: '700 16px Figtree', color: 'var(--color-text-muted)' }}
        >
          ✕
        </button>
      </div>

      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 16, overflowY: 'auto' }}>
        {warned && (
          <div
            style={{
              background: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
              border: '1.5px solid var(--color-warning)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
            }}
          >
            <p style={{ font: '600 12.5px Figtree', color: 'var(--color-warning)', marginBottom: 6 }}>
              ! Planted too close to a neighbor
            </p>
            <p style={{ font: '400 11.5px/1.4 Figtree', color: 'var(--color-text-muted)', marginBottom: 8 }}>
              {crop.name} wants at least {crop.spacingIn}" from the next plant. Move one of them apart, or dismiss
              if you're fine with it.
            </p>
            <button onClick={onDismissWarning} className="btn btn-secondary" style={{ padding: '5px 12px', font: '600 11.5px Figtree' }}>
              Dismiss for this plant
            </button>
          </div>
        )}

        <label>
          <span style={{ display: 'block', font: '600 12px Figtree', marginBottom: 6 }}>Variety (optional)</span>
          <input
            value={variety}
            placeholder="e.g. Cherokee Purple"
            onChange={(e) => setVariety(e.target.value)}
            onBlur={() => onSetVariety(variety.trim() || undefined)}
            style={{
              width: '100%',
              padding: '9px 11px',
              borderRadius: 'var(--radius-sm)',
              border: '1.5px solid var(--color-divider)',
              font: '400 13px Figtree',
            }}
          />
        </label>

        <div>
          <span style={{ display: 'block', font: '600 12px Figtree', marginBottom: 8 }}>Planting &amp; harvest</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, font: '400 13px Figtree' }}>
            {schedule.startIndoors && (
              <Row label="Start indoors" value={formatDate(schedule.startIndoors)} />
            )}
            <Row label={schedule.sowOrTransplantLabel} value={formatDate(schedule.sowOrTransplant)} />
            <Row label="Expected harvest" value={formatDate(schedule.harvest)} />
            <Row label="Spacing" value={`${crop.spacingIn}" apart`} />
          </div>
        </div>

        <div
          style={{
            background: 'var(--color-surface)',
            borderRadius: 'var(--radius-md)',
            padding: '10px 12px',
          }}
        >
          <p style={{ font: '400 13px/1.5 Caveat, cursive', color: '#6b6155' }}>{crop.tip}</p>
        </div>
      </div>

      <div style={{ padding: 16, borderTop: '1.5px solid var(--color-divider)', display: 'flex', gap: 8 }}>
        <button onClick={onRemove} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
          Remove
        </button>
        {groupCount > 1 && (
          <button onClick={onRemoveGroup} className="btn btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>
            Remove patch
          </button>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--color-text-muted)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
