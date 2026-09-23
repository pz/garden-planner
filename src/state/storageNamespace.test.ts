import { describe, expect, it } from 'vitest';
import { withNamespace } from './storageNamespace';

describe('withNamespace', () => {
  it('leaves keys unchanged when there is no namespace (production builds)', () => {
    expect(withNamespace(undefined, 'garden-planner-index/v1')).toBe('garden-planner-index/v1');
    expect(withNamespace('', 'garden-planner-index/v1')).toBe('garden-planner-index/v1');
  });

  it('prefixes every key in a preview build, so previews never share keys with the live app', () => {
    expect(withNamespace('pr-15:', 'garden-planner-index/v1')).toBe('pr-15:garden-planner-index/v1');
    expect(withNamespace('pr-15:', 'garden-planner-plan:abc')).not.toBe(withNamespace('pr-16:', 'garden-planner-plan:abc'));
  });
});
