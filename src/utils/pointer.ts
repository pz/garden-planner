/**
 * Whether a press is a "context click": a secondary-button press, or on macOS a Ctrl-click, which
 * the browser reports as the primary button with ctrlKey held and follows with a contextmenu
 * event. Context clicks open the plant menu; they must never start a pan, drag or long-press.
 */
export function isContextPress(e: { button: number; ctrlKey: boolean }): boolean {
  return e.button === 2 || (e.button === 0 && e.ctrlKey);
}

/**
 * Whether a pointer move arrived with no button down. That happens when the matching pointerup
 * was swallowed (the browser's own context menu eats it), so a gesture still tracking the
 * pointer would otherwise carry on as a "drag" with the button released.
 */
export function isReleasedMove(e: { pointerType: string; buttons: number }): boolean {
  return e.pointerType === 'mouse' && e.buttons === 0;
}
