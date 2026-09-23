import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DISMISSED_TIPS,
  dismissTip,
  isTipDismissed,
  parseDismissedTips,
  restoreTip,
  type DismissedTips,
} from './dismissedTips';

const withTomato: DismissedTips = { version: 1, cropIds: ['tomato'] };

describe('parseDismissedTips', () => {
  it('round-trips a stored value', () => {
    expect(parseDismissedTips(JSON.stringify(withTomato))).toEqual(withTomato);
  });

  it('falls back to none dismissed for missing, malformed, or wrong-version input', () => {
    for (const raw of [null, '', '{not json', 'null', '[]', '{"version":2,"cropIds":["tomato"]}', '{"version":1}']) {
      expect(parseDismissedTips(raw), String(raw)).toEqual(DEFAULT_DISMISSED_TIPS);
    }
  });

  it('drops non-string entries rather than discarding the whole list', () => {
    expect(parseDismissedTips('{"version":1,"cropIds":["kale",3,null]}')).toEqual({ version: 1, cropIds: ['kale'] });
  });
});

describe('dismissTip', () => {
  it('adds the crop without touching the previous state', () => {
    const next = dismissTip(withTomato, 'kale');
    expect(next.cropIds).toEqual(['tomato', 'kale']);
    expect(withTomato.cropIds).toEqual(['tomato']);
  });

  it('returns the same object when already dismissed', () => {
    expect(dismissTip(withTomato, 'tomato')).toBe(withTomato);
  });
});

describe('restoreTip', () => {
  it('removes only that crop', () => {
    const state: DismissedTips = { version: 1, cropIds: ['tomato', 'kale'] };
    expect(restoreTip(state, 'tomato').cropIds).toEqual(['kale']);
    expect(state.cropIds).toEqual(['tomato', 'kale']);
  });

  it('returns the same object when not dismissed', () => {
    expect(restoreTip(withTomato, 'kale')).toBe(withTomato);
  });
});

describe('isTipDismissed', () => {
  it('is per crop', () => {
    expect(isTipDismissed(withTomato, 'tomato')).toBe(true);
    expect(isTipDismissed(withTomato, 'kale')).toBe(false);
  });
});
