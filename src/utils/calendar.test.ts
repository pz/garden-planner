import { describe, expect, it } from 'vitest';
import type { PlantInstance } from '../types';
import { buildCalendarEntries, earliestScheduledDate, groupByMonth, type CalendarEntry } from './calendar';
import { scheduleFor } from './dates';
import { getCrop } from '../data/crops';
import { getZone } from '../data/zones';

function plant(overrides: Partial<PlantInstance>): PlantInstance {
  return { id: 'p1', cropId: 'carrot', x: 0, y: 0, groupId: 'g1', ...overrides };
}

function entryScheduledOn(groupId: string, date: Date): CalendarEntry {
  return {
    groupId,
    cropId: 'carrot',
    cropName: 'Carrot',
    count: 1,
    schedule: { sowOrTransplant: date, sowOrTransplantLabel: 'Sow outside', harvest: date },
  };
}

describe('buildCalendarEntries', () => {
  it('returns an empty list for an empty plan', () => {
    expect(buildCalendarEntries([], '6', 2024)).toEqual([]);
  });

  it('collapses plants sharing a groupId into one entry with their count', () => {
    const plants = [
      plant({ id: 'a', groupId: 'patch', cropId: 'carrot' }),
      plant({ id: 'b', groupId: 'patch', cropId: 'carrot' }),
      plant({ id: 'c', groupId: 'patch', cropId: 'carrot' }),
    ];
    const entries = buildCalendarEntries(plants, '6', 2024);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ groupId: 'patch', cropId: 'carrot', count: 3 });
  });

  it('keeps distinct groups of the same crop as separate entries', () => {
    const plants = [
      plant({ id: 'a', groupId: 'g1', cropId: 'lettuce' }),
      plant({ id: 'b', groupId: 'g2', cropId: 'lettuce' }),
    ];
    const entries = buildCalendarEntries(plants, '6', 2024);
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.groupId).sort()).toEqual(['g1', 'g2']);
  });

  it('sorts entries chronologically by earliest scheduled date, not by insertion order', () => {
    // beans (direct-sow, 1 week after last frost) is scheduled later than onion
    // (transplant, started indoors 8 weeks before last frost) even though beans is added first.
    const plants = [plant({ id: 'a', groupId: 'g-beans', cropId: 'beans' }), plant({ id: 'b', groupId: 'g-onion', cropId: 'onion' })];
    const entries = buildCalendarEntries(plants, '6', 2024);
    expect(entries.map((e) => e.cropId)).toEqual(['onion', 'beans']);
  });

  it('computes the same schedule as scheduleFor for each entry', () => {
    const plants = [plant({ groupId: 'g1', cropId: 'tomato' })];
    const zone = getZone('6');
    const expected = scheduleFor(getCrop('tomato'), zone, 2024);
    const entries = buildCalendarEntries(plants, '6', 2024);
    expect(entries[0].schedule).toEqual(expected);
  });
});

describe('earliestScheduledDate', () => {
  it('prefers startIndoors when present', () => {
    const schedule = scheduleFor(getCrop('tomato'), getZone('6'), 2024);
    expect(earliestScheduledDate(schedule)).toEqual(schedule.startIndoors);
  });

  it('falls back to sowOrTransplant when there is no indoor start', () => {
    const schedule = scheduleFor(getCrop('carrot'), getZone('6'), 2024);
    expect(schedule.startIndoors).toBeUndefined();
    expect(earliestScheduledDate(schedule)).toEqual(schedule.sowOrTransplant);
  });
});

describe('groupByMonth', () => {
  it('returns an empty list for no entries', () => {
    expect(groupByMonth([])).toEqual([]);
  });

  it('collapses entries in the same month into one group', () => {
    const entries = [
      entryScheduledOn('a', new Date(2024, 3, 1)),
      entryScheduledOn('b', new Date(2024, 3, 15)),
    ];
    const groups = groupByMonth(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toMatch(/April/);
    expect(groups[0].entries.map((e) => e.groupId)).toEqual(['a', 'b']);
  });

  it('produces separate groups, in order, for entries in different months', () => {
    const entries = [
      entryScheduledOn('a', new Date(2024, 3, 1)), // April
      entryScheduledOn('b', new Date(2024, 4, 1)), // May
    ];
    const groups = groupByMonth(entries);
    expect(groups.map((g) => g.entries.map((e) => e.groupId))).toEqual([['a'], ['b']]);
    expect(groups[0].label).toMatch(/April/);
    expect(groups[1].label).toMatch(/May/);
  });

  it('does not collapse the same calendar month across different years', () => {
    const entries = [
      entryScheduledOn('a', new Date(2024, 3, 1)),
      entryScheduledOn('b', new Date(2025, 3, 1)),
    ];
    const groups = groupByMonth(entries);
    expect(groups).toHaveLength(2);
    expect(groups[0].label).not.toEqual(groups[1].label);
  });

  it('only merges same-month runs that are adjacent, since it assumes sorted input', () => {
    // Out-of-order input (April, May, April) produces three groups, not two —
    // groupByMonth doesn't re-sort, it only collapses consecutive matching labels.
    const entries = [
      entryScheduledOn('a', new Date(2024, 3, 1)),
      entryScheduledOn('b', new Date(2024, 4, 1)),
      entryScheduledOn('c', new Date(2024, 3, 10)),
    ];
    const groups = groupByMonth(entries);
    expect(groups).toHaveLength(3);
  });
});
