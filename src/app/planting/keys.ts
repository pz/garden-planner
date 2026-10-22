export const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** The modifier key's name on this platform, for shortcut hints. */
export const MOD = IS_MAC ? '⌘' : 'Ctrl+';

/** Whether this key, pressed alone, makes a click add to the selection: Shift anywhere, ⌘ on a Mac, Ctrl elsewhere (on a Mac Ctrl-click is a context click). */
export const isSelectModifierKey = (key: string) => key === 'Shift' || key === (IS_MAC ? 'Meta' : 'Control');

/** Whether this press has the platform's command key (⌘ on a Mac, Ctrl elsewhere) — or either, since a Ctrl-click means the same thing on both. */
export const hasMod = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;
