/** The modifier key's name on this platform, for shortcut hints. */
export const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

/** Whether this press has the platform's command key (⌘ on a Mac, Ctrl elsewhere) — or either, since a Ctrl-click means the same thing on both. */
export const hasMod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;
