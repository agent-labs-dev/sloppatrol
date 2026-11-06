import { expect, it } from 'vitest';
import { heldMutants } from '../../domain/index.js';

it('uses Lua inequality when flipping equality in a kept Lua line', () => {
  const files = [{ path: 'src/equal.lua', text: 'local function equal(a, b)\n  return a == b\nend\n' }];
  const [bug] = heldMutants(files, files, 1);

  expect(bug).toBeDefined();
  // Lua rejects != while loading the file, even when the function is never called.
  expect(bug!.before.replace.trim()).toBe('return a ~= b');
  expect(bug!.after.replace.trim()).toBe('return a ~= b');
});
