import type { Bed, PlantInstance } from '../types';

/** The part of a plan the layout editor can change, as it was before one edit. */
export interface LayoutSnapshot {
  beds: Bed[];
  plants: PlantInstance[];
}

/** How many layout edits the editor can step back through. */
export const LAYOUT_HISTORY_LIMIT = 50;

/** Records `snapshot` as the newest undo step, dropping the oldest past the limit. */
export function pushSnapshot(stack: LayoutSnapshot[], snapshot: LayoutSnapshot): LayoutSnapshot[] {
  const next = [...stack, snapshot];
  return next.length > LAYOUT_HISTORY_LIMIT ? next.slice(next.length - LAYOUT_HISTORY_LIMIT) : next;
}

/** The newest undo step and the stack without it, or null when there's nothing to undo. */
export function popSnapshot(stack: LayoutSnapshot[]): { snapshot: LayoutSnapshot; rest: LayoutSnapshot[] } | null {
  if (stack.length === 0) return null;
  return { snapshot: stack[stack.length - 1], rest: stack.slice(0, -1) };
}
