import type { CheckResult } from '../../domain/index.js';

/** How test runners report the tests that passed, most specific first. */
const PATTERNS: RegExp[] = [
  /ℹ pass (\d+)/, // node:test
  /Tests:?\s+(?:\d+ \w+ \| )*(\d+) passed/, // vitest, jest
  /test result: ok\. (\d+) passed/g, // cargo, one line per crate
  /(\d+) passed/, // pytest
];

/** The tests the checks ran, when their output says. */
export function testsPassed(results: CheckResult[]): number | undefined {
  let total: number | undefined;
  for (const { output } of results) {
    for (const pattern of PATTERNS) {
      const hits = pattern.global ? [...output.matchAll(pattern)] : [pattern.exec(output)].filter((m) => m !== null);
      if (!hits.length) continue;
      total = (total ?? 0) + hits.reduce((sum, m) => sum + Number(m[1]), 0);
      break;
    }
  }
  return total;
}
