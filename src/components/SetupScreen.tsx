import { useState } from 'react';
import { useGarden } from '../state/gardenStore';
import { ZONES, getZone, zoneFirstFrostDate, zoneLastFrostDate } from '../data/zones';
import { formatDate } from '../utils/dates';
import type { SunExposure } from '../types';

const SUN_OPTIONS: { id: SunExposure; label: string; hint: string }[] = [
  { id: 'full-sun', label: 'Full sun', hint: '6+ hours of direct sun' },
  { id: 'part-shade', label: 'Part shade', hint: '3–6 hours of direct sun' },
  { id: 'shade', label: 'Shade', hint: 'Under 3 hours of direct sun' },
];

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const { plan, setProfile } = useGarden();
  const [zoneId, setZoneId] = useState(plan.profile.zoneId);
  const [sunExposure, setSunExposure] = useState<SunExposure>(plan.profile.sunExposure);

  const zone = getZone(zoneId);
  const year = new Date().getFullYear();

  function handleContinue() {
    setProfile({ zoneId, sunExposure, onboarded: true });
    onDone();
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px' }}>
      <p style={{ font: '400 17px Caveat, cursive', color: 'var(--color-text-muted)', marginBottom: 4 }}>
        Let&rsquo;s get your garden started
      </p>
      <h1 style={{ fontSize: 30, marginBottom: 28 }}>A little about your garden</h1>

      <label style={{ display: 'block', marginBottom: 22 }}>
        <span style={{ display: 'block', font: '600 13px Figtree', marginBottom: 8 }}>
          USDA hardiness zone
        </span>
        <select
          value={zoneId}
          onChange={(e) => setZoneId(e.target.value)}
          style={{
            width: '100%',
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--color-divider)',
            font: '500 15px Figtree',
            background: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
          }}
        >
          {ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </label>

      <div style={{ marginBottom: 28 }}>
        <span style={{ display: 'block', font: '600 13px Figtree', marginBottom: 8 }}>Sun exposure</span>
        <div style={{ display: 'flex', gap: 10 }}>
          {SUN_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSunExposure(opt.id)}
              className="btn"
              style={{
                flex: 1,
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 2,
                padding: '12px 14px',
                borderColor: sunExposure === opt.id ? 'var(--color-accent)' : 'var(--color-divider)',
                background: sunExposure === opt.id ? 'color-mix(in srgb, var(--color-accent) 12%, transparent)' : 'var(--color-surface-raised)',
              }}
            >
              <span style={{ font: '600 13px Figtree' }}>{opt.label}</span>
              <span style={{ font: '400 11px Figtree', color: 'var(--color-text-muted)' }}>{opt.hint}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          background: 'var(--color-surface-raised)',
          border: '1.5px solid var(--color-divider)',
          borderRadius: 'var(--radius-md)',
          padding: '16px 18px',
          marginBottom: 32,
        }}
      >
        <p style={{ font: '600 13px Figtree', marginBottom: 8 }}>What that means for you</p>
        <p style={{ font: '400 13px/1.5 Figtree', color: 'var(--color-text-muted)' }}>
          Your average last spring frost is around <strong>{formatDate(zoneLastFrostDate(zone, year))}</strong>,
          and your average first fall frost is around{' '}
          <strong>{formatDate(zoneFirstFrostDate(zone, year))}</strong>. We&rsquo;ll use these to suggest planting
          and harvest dates for whatever you grow.
        </p>
      </div>

      <button onClick={handleContinue} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px 18px' }}>
        Continue to your garden bed
      </button>
    </div>
  );
}
