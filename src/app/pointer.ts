/**
 * Whether a press is a "context click": a secondary-button press, or on macOS (`mac`) a Ctrl-click,
 * which the browser reports as the primary button with ctrlKey held and follows with a contextmenu
 * event. Context clicks open the plant menu; they must never start a pan, drag or long-press.
 * Elsewhere Ctrl-click is no context click (nothing follows it), it is the select-more modifier.
 */
export function isContextPress(e: { button: number; ctrlKey: boolean }, mac: boolean): boolean {
  return e.button === 2 || (mac && e.button === 0 && e.ctrlKey);
}

/**
 * Whether a pointer move arrived with no button down. That happens when the matching pointerup
 * was swallowed (the browser's own context menu eats it), so a gesture still tracking the
 * pointer would otherwise carry on as a "drag" with the button released.
 */
export function isReleasedMove(e: { pointerType: string; buttons: number }): boolean {
  return e.pointerType === 'mouse' && e.buttons === 0;
}

/**
 * A CSS `clip-path` that traces a polygon bed, for a box of `pxPerInch` pixels per inch. Browsers
 * hit-test inside a clip-path only, so a polygon's empty bounding box doesn't swallow presses
 * meant for the beds beneath it.
 */
export function polygonClipPath(points: { x: number; y: number }[], pxPerInch: number): string {
  return `polygon(${points.map((p) => `${p.x * pxPerInch}px ${p.y * pxPerInch}px`).join(', ')})`;
}
