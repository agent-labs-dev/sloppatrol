import { describe, expect, it } from 'vitest';
import type { CheckResult } from '../../domain/index.js';
import { testsPassed } from '../../gate/index.js';

const check = (output: string): CheckResult => ({
  name: 'test',
  command: 'test',
  ok: true,
  exitCode: 0,
  durationMs: 1,
  output,
});

describe('the tests a check ran', () => {
  it.each([
    ['node:test, spec', 'ℹ tests 12\nℹ pass 12\nℹ fail 0', 12],
    ['node:test, TAP', '1..12\n# tests 12\n# suites 0\n# pass 12\n# fail 0', 12],
    ['vitest', ' Test Files  9 passed (9)\n      Tests  40 passed (40)', 40],
    ['jest', 'Tests:       2 skipped, 31 passed, 33 total', 31],
    ['pytest', '===== 15044 passed, 31 skipped, 28 warnings in 220.72s =====', 15044],
    ['cargo, two crates', 'test result: ok. 3 passed; 0 failed\ntest result: ok. 4 passed; 0 failed', 7],
  ])('are read from %s output', (_, output, count) => {
    expect(testsPassed([check(output)])).toBe(count);
  });

  it('are unknown when no check says', () => {
    expect(testsPassed([check('All checks passed!')])).toBeUndefined();
  });
});
