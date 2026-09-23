import { useState } from 'react';
import { dismissTip, isTipDismissed, parseDismissedTips, restoreTip, type DismissedTips } from './dismissedTips';
import { storageKey } from './storageNamespace';

const DISMISSED_TIPS_KEY = storageKey('garden-planner-dismissed-tips/v1');

/** React binding for dismissed tips: reads and writes through to localStorage. */
export function useDismissedTip(cropId: string) {
  const [state, setState] = useState<DismissedTips>(() =>
    parseDismissedTips(localStorage.getItem(DISMISSED_TIPS_KEY)),
  );

  const update = (fn: (s: DismissedTips, id: string) => DismissedTips) => {
    const next = fn(parseDismissedTips(localStorage.getItem(DISMISSED_TIPS_KEY)), cropId);
    localStorage.setItem(DISMISSED_TIPS_KEY, JSON.stringify(next));
    setState(next);
  };

  return {
    dismissed: isTipDismissed(state, cropId),
    dismiss: () => update(dismissTip),
    restore: () => update(restoreTip),
  };
}
