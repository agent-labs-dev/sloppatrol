/**
 * Lines a refactor must never add: each one silences a check or a test, so
 * a passing check would no longer mean the behaviour held.
 */
export const SUPPRESSIONS: { name: string; pattern: RegExp }[] = [
  {
    name: 'lint suppression',
    pattern:
      /eslint-disable|biome-ignore|\/\/\s*nolint|swiftlint:disable|# noqa|@SuppressWarnings|@Suppress\(|#!?\[allow\(/,
  },
  { name: 'type suppression', pattern: /@ts-ignore|@ts-expect-error|@ts-nocheck|# type: ignore|# pyright: ignore/ },
  { name: 'type escape', pattern: /\bas any\b|\bas unknown as\b|:\s*any\b/ },
  { name: 'coverage exclusion', pattern: /istanbul ignore|c8 ignore|v8 ignore|# pragma: no cover/ },
  {
    name: 'skipped or focused test',
    pattern:
      /\b(it|test|describe|suite)\.(skip|only|todo)\s*\(|\b[xf](it|describe|test)\s*\(|@pytest\.mark\.(skip|xfail)|@unittest\.skip|\bt\.Skip(Now|f)?\(|#\[ignore\]|@Disabled\b|@Ignore\b|XCTSkip/,
  },
];

/** One test case, in the test frameworks of the playbook's stacks. */
export const TEST_CASE =
  /\b(it|test)(\.each\S*)?\s*\(|^\s*(async\s+)?def test_?\w*\s*\(|\bfunc Test\w*\s*\(|@(Test|ParameterizedTest)\b|#\[(tokio::)?test\]|\bfunc test\w*\s*\(/;

export function count(lines: string[], pattern: RegExp): number {
  return lines.filter((line) => pattern.test(line)).length;
}
