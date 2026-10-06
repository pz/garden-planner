import { describe, expect, it } from 'vitest';
import { LAYOUT_HISTORY_LIMIT, popSnapshot, pushSnapshot, type LayoutSnapshot } from './layoutHistory';

function snap(n: number): LayoutSnapshot {
  return { beds: [{ id: `b${n}`, name: `Bed ${n}`, shape: 'rect', cx: 0, cy: 0, widthIn: 12, heightIn: 12, rotationDeg: 0 }], plants: [] };
}

describe('pushSnapshot', () => {
  it('appends without mutating the previous stack', () => {
    const stack = [snap(1)];
    const next = pushSnapshot(stack, snap(2));
    expect(next.map((s) => s.beds[0].id)).toEqual(['b1', 'b2']);
    expect(stack).toHaveLength(1);
  });

  it('keeps exactly the limit, then drops the oldest step', () => {
    let stack: LayoutSnapshot[] = [];
    for (let i = 1; i <= LAYOUT_HISTORY_LIMIT; i++) stack = pushSnapshot(stack, snap(i));
    expect(stack).toHaveLength(LAYOUT_HISTORY_LIMIT);
    expect(stack[0].beds[0].id).toBe('b1');

    stack = pushSnapshot(stack, snap(LAYOUT_HISTORY_LIMIT + 1));
    expect(stack).toHaveLength(LAYOUT_HISTORY_LIMIT);
    expect(stack[0].beds[0].id).toBe('b2');
    expect(stack[stack.length - 1].beds[0].id).toBe(`b${LAYOUT_HISTORY_LIMIT + 1}`);
  });
});

describe('popSnapshot', () => {
  it('returns the newest step and the rest', () => {
    const stack = [snap(1), snap(2)];
    const popped = popSnapshot(stack);
    expect(popped?.snapshot).toBe(stack[1]);
    expect(popped?.rest).toEqual([stack[0]]);
    expect(stack).toHaveLength(2);
  });

  it('is null for an empty stack', () => {
    expect(popSnapshot([])).toBeNull();
  });
});
