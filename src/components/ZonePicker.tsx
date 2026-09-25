import { ZONES } from '../data/zones';

/**
 * One button per hardiness zone, colored to match the map overlay. Doubles as the map's legend
 * and as the manual override when the map's pick isn't right.
 */
export function ZonePicker({ zoneId, onSelect }: { zoneId: string; onSelect: (id: string) => void }) {
  return (
    <div role="group" aria-labelledby="zone-picker-label" style={{ display: 'flex', gap: 6 }}>
      {ZONES.map((z) => {
        const active = z.id === zoneId;
        return (
          <button
            key={z.id}
            type="button"
            className="zone-button"
            aria-pressed={active}
            aria-label={z.label}
            title={z.label}
            onClick={() => onSelect(z.id)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 40,
              padding: 0,
              borderRadius: 10,
              border: active ? '2px solid var(--color-text)' : '1.5px solid color-mix(in srgb, var(--color-text) 14%, transparent)',
              background: `color-mix(in srgb, ${z.mapColor} ${active ? 100 : 50}%, var(--color-surface-raised))`,
              font: `${active ? 700 : 600} 14px Figtree`,
              color: 'var(--color-text)',
              boxShadow: active ? 'var(--shadow-sm)' : 'none',
            }}
          >
            {z.id}
          </button>
        );
      })}
    </div>
  );
}
