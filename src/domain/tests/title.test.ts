import { describe, expect, it } from 'vitest';
import { titleOf } from '../../domain/index.js';

describe('the title of a refactor', () => {
  it('gets the type of its side', () => {
    expect(titleOf({ side: 'source', title: 'Split the router' })).toBe('refactor: Split the router');
    expect(titleOf({ side: 'tests', title: 'Pin the discounts' })).toBe('test: Pin the discounts');
  });

  it("keeps a type the surveyor wrote in the repo's own style", () => {
    expect(titleOf({ side: 'source', title: 'refactor(message): import at module top' })).toBe(
      'refactor(message): import at module top',
    );
    expect(titleOf({ side: 'tests', title: 'test: prove the route' })).toBe('test: prove the route');
  });
});
