import { describe, expect, it } from 'vitest';
import { isContextPress, isReleasedMove } from './pointer';

describe('isContextPress', () => {
  it('treats the secondary button as a context press', () => {
    expect(isContextPress({ button: 2, ctrlKey: false })).toBe(true);
  });
  it('treats a primary press with Ctrl held (macOS Ctrl-click) as a context press', () => {
    expect(isContextPress({ button: 0, ctrlKey: true })).toBe(true);
  });
  it('does not treat a plain primary or middle press as one', () => {
    expect(isContextPress({ button: 0, ctrlKey: false })).toBe(false);
    expect(isContextPress({ button: 1, ctrlKey: false })).toBe(false);
  });
});

describe('isReleasedMove', () => {
  it('flags a mouse move with no buttons down', () => {
    expect(isReleasedMove({ pointerType: 'mouse', buttons: 0 })).toBe(true);
  });
  it('does not flag a mouse move with a button down', () => {
    expect(isReleasedMove({ pointerType: 'mouse', buttons: 1 })).toBe(false);
  });
  it('never flags touch or pen, which report no buttons for a contact in some browsers', () => {
    expect(isReleasedMove({ pointerType: 'touch', buttons: 0 })).toBe(false);
    expect(isReleasedMove({ pointerType: 'pen', buttons: 0 })).toBe(false);
  });
});
