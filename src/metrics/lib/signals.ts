import type { Signals } from '../../domain/index.js';

const COMMENT = /^\s*(\/\/|#(?!!)|\/\*|\*|--|""")/;
const MOCK =
  /\b(jest|vi)\.(mock|spyOn)\(|\bsinon\.|\bunittest\.mock\b|@(mock\.)?patch\(|\bmocker\.patch|\bmonkeypatch\.setattr|\bgomock\b|\bMockito\b|\bmockk\b/;
const SUPPRESSION =
  /eslint-disable|biome-ignore|@ts-ignore|@ts-expect-error|# type: ignore|# noqa|\/\/\s*nolint|@Suppress/;

/** Facts about one file that code can measure without understanding it. */
export function measure(text: string): Signals {
  const lines = text.split('\n');
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)?.[0].replace(/\t/g, '    ').length ?? 0);
  const unit = Math.min(...indents.filter((n) => n > 0), 4) || 4;
  return {
    lines: lines.length,
    maxNesting: indents.length ? Math.floor(Math.max(...indents) / unit) : 0,
    commentLines: lines.filter((line) => COMMENT.test(line)).length,
    mocks: lines.filter((line) => MOCK.test(line)).length,
    suppressions: lines.filter((line) => SUPPRESSION.test(line)).length,
  };
}

export function sumSignals(all: Signals[]): Signals {
  const total: Signals = { lines: 0, maxNesting: 0, commentLines: 0, mocks: 0, suppressions: 0 };
  for (const s of all) {
    total.lines += s.lines;
    total.maxNesting = Math.max(total.maxNesting, s.maxNesting);
    total.commentLines += s.commentLines;
    total.mocks += s.mocks;
    total.suppressions += s.suppressions;
  }
  return total;
}
