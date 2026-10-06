/**
 * Which crops' growing tips the user has dismissed. This is a user preference, not part of a
 * garden plan: a tip dismissed once stays dismissed across every garden.
 */
export interface DismissedTips {
  version: 1;
  cropIds: string[];
}

export const DEFAULT_DISMISSED_TIPS: DismissedTips = { version: 1, cropIds: [] };

/** Parses dismissed tips from raw storage content, falling back to none dismissed for anything unusable. */
export function parseDismissedTips(raw: string | null): DismissedTips {
  try {
    if (!raw) return DEFAULT_DISMISSED_TIPS;
    const parsed = JSON.parse(raw) as DismissedTips;
    if (parsed?.version !== 1 || !Array.isArray(parsed.cropIds)) return DEFAULT_DISMISSED_TIPS;
    return { version: 1, cropIds: parsed.cropIds.filter((id) => typeof id === 'string') };
  } catch {
    return DEFAULT_DISMISSED_TIPS;
  }
}

export function isTipDismissed(state: DismissedTips, cropId: string): boolean {
  return state.cropIds.includes(cropId);
}

/** Marks a crop's tip dismissed. A no-op (same object) if it already is. */
export function dismissTip(state: DismissedTips, cropId: string): DismissedTips {
  if (isTipDismissed(state, cropId)) return state;
  return { ...state, cropIds: [...state.cropIds, cropId] };
}

/** Brings a dismissed tip back. A no-op (same object) if it isn't dismissed. */
export function restoreTip(state: DismissedTips, cropId: string): DismissedTips {
  if (!isTipDismissed(state, cropId)) return state;
  return { ...state, cropIds: state.cropIds.filter((id) => id !== cropId) };
}
