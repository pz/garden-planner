import type { PlantInstance } from '../types';
import { getCrop } from '../data/crops';
import { getZone, zoneFirstFrostDate, zoneLastFrostDate } from '../data/zones';
import { buildCalendarEntries, groupByMonth, type CalendarEntry } from '../utils/calendar';
import { formatDate } from '../utils/dates';
import { CROP_COLORS, PlantMark } from './PlantMark';

export function PlantingCalendar({ plants, zoneId }: { plants: PlantInstance[]; zoneId: string }) {
  const year = new Date().getFullYear();
  const zone = getZone(zoneId);
  const entries = buildCalendarEntries(plants, zoneId, year);

  if (entries.length === 0) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center' }}>
        <p style={{ font: '400 17px Caveat, cursive', color: '#9a8c76' }}>
          Nothing planted yet — add crops to the bed to see their planting calendar.
        </p>
      </div>
    );
  }

  const months = groupByMonth(entries);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 640 }}>
      <p style={{ font: '400 13px Figtree', color: 'var(--color-text-muted)' }}>
        {zone.label} · last frost ~{formatDate(zoneLastFrostDate(zone, year))} · first frost ~
        {formatDate(zoneFirstFrostDate(zone, year))}
      </p>

      {months.map(({ label, entries: monthEntries }) => (
        <div key={label}>
          <h2 style={{ font: '700 14px Figtree', marginBottom: 10 }}>{label}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {monthEntries.map((entry) => (
              <CalendarRow key={entry.groupId} entry={entry} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarRow({ entry }: { entry: CalendarEntry }) {
  const crop = getCrop(entry.cropId);
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '10px 12px',
        background: 'var(--color-surface-raised)',
        border: '1.5px solid var(--color-divider)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <PlantMark family={crop.family} color={CROP_COLORS[crop.id]} diameter={26} />
      <div style={{ flex: 1 }}>
        <div style={{ font: '600 13px Figtree' }}>
          {entry.cropName}
          {entry.count > 1 ? ` · patch of ${entry.count}` : ''}
        </div>
        <div style={{ font: '400 12px Figtree', color: 'var(--color-text-muted)' }}>
          {entry.schedule.startIndoors && `Start indoors ${formatDate(entry.schedule.startIndoors)} · `}
          {entry.schedule.sowOrTransplantLabel} {formatDate(entry.schedule.sowOrTransplant)} · Harvest{' '}
          {formatDate(entry.schedule.harvest)}
        </div>
      </div>
    </div>
  );
}
