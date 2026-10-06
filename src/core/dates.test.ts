import { describe, expect, it } from 'vitest';
import type { CropDef } from '../types';
import { getZone } from '../data/zones';
import { formatDate, scheduleFor } from './dates';

const transplantCrop: CropDef = {
  id: 'tomato',
  name: 'Tomato',
  family: 'fruiting',
  spacingIn: 24,
  defaultPatch: false,
  sowMethod: 'transplant',
  startIndoorsWeeksBeforeLastFrost: 6,
  transplantWeeksAfterLastFrost: 1,
  daysToMaturity: 70,
};

const directSowCrop: CropDef = {
  id: 'carrot',
  name: 'Carrot',
  family: 'root',
  spacingIn: 3,
  defaultPatch: true,
  sowMethod: 'direct-sow',
  directSowWeeksRelativeToLastFrost: -2,
  daysToMaturity: 70,
};

describe('scheduleFor', () => {
  it('computes start-indoors, transplant, and harvest dates for a transplant crop', () => {
    const zone = getZone('6'); // last frost: April 15
    const schedule = scheduleFor(transplantCrop, zone, 2024);

    expect(schedule.startIndoors).toEqual(new Date(2024, 2, 4)); // 6 weeks (42 days) before Apr 15
    expect(schedule.sowOrTransplant).toEqual(new Date(2024, 3, 22)); // 1 week after Apr 15
    expect(schedule.sowOrTransplantLabel).toBe('Transplant outside');
    expect(schedule.harvest).toEqual(new Date(2024, 6, 1)); // +70 days from Apr 22
  });

  it('computes sow and harvest dates for a direct-sow crop, with no startIndoors', () => {
    const zone = getZone('6'); // last frost: April 15
    const schedule = scheduleFor(directSowCrop, zone, 2024);

    expect(schedule.startIndoors).toBeUndefined();
    expect(schedule.sowOrTransplant).toEqual(new Date(2024, 3, 1)); // 2 weeks before Apr 15
    expect(schedule.sowOrTransplantLabel).toBe('Sow outside');
    expect(schedule.harvest).toEqual(new Date(2024, 5, 10)); // +70 days from Apr 1
  });

  it('defaults missing week offsets to zero', () => {
    const zone = getZone('6');
    const crop: CropDef = { ...directSowCrop, directSowWeeksRelativeToLastFrost: undefined };
    const schedule = scheduleFor(crop, zone, 2024);
    expect(schedule.sowOrTransplant).toEqual(new Date(2024, 3, 15)); // == last frost date
  });
});

describe('formatDate', () => {
  it('formats a date as an abbreviated month and day', () => {
    // Locale-dependent, but stable across environments using en-US-like defaults.
    expect(formatDate(new Date(2024, 3, 22))).toMatch(/Apr/);
    expect(formatDate(new Date(2024, 3, 22))).toMatch(/22/);
  });
});
