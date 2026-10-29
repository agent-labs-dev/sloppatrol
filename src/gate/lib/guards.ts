import type { GuardFinding, Side } from '../../domain/index.js';
import { matchesAny } from '../../globs/index.js';
import type { ChangedFile } from './diff.js';
import { FROZEN } from './frozen.js';
import { count, SUPPRESSIONS, TEST_CASE } from './markers.js';

export type GuardRules = {
  side: Side;
  /** Globs that name test files. */
  tests: readonly string[];
  /** Globs no agent may change, on top of the built-in frozen files. */
  ignore: readonly string[];
  /** Test files no check runs. */
  uncheckedTests: readonly string[];
  maxFiles: number;
  maxLines: number;
};

function paths(file: ChangedFile): string[] {
  return file.oldPath && file.oldPath !== file.path ? [file.oldPath, file.path] : [file.path];
}

/**
 * The rules on the diff itself (ADR 0002). Each finding rejects the
 * refactor; no agent can overrule one.
 */
export function checkGuards(diff: ChangedFile[], rules: GuardRules): GuardFinding[] {
  if (diff.length === 0) return [{ guard: 'empty', detail: 'The refactor changed nothing.' }];
  const findings: GuardFinding[] = [];
  const other = rules.side === 'source' ? 'test' : 'source';
  for (const file of diff) {
    for (const path of paths(file)) {
      const isTest = matchesAny(path, rules.tests);
      if ((rules.side === 'source') === isTest)
        findings.push({
          guard: 'one-side',
          file: path,
          detail: `A ${rules.side} refactor may not change a ${other} file.`,
        });
      if (isTest && matchesAny(path, rules.uncheckedTests))
        findings.push({
          guard: 'unchecked',
          file: path,
          detail: 'No check runs this test file, so nothing proves the change.',
        });
      if (matchesAny(path, FROZEN) || matchesAny(path, rules.ignore))
        findings.push({ guard: 'frozen', file: path, detail: 'This file is frozen: no refactor may change it.' });
    }
  }
  // Counted over the whole diff: a suppression that moves with its code to a
  // new file is not a new one.
  for (const { name, pattern } of SUPPRESSIONS) {
    const removed = diff.reduce((sum, f) => sum + count(f.removed, pattern), 0);
    const added = diff.reduce((sum, f) => sum + count(f.added, pattern), 0);
    const where = diff.find((f) => count(f.added, pattern) > count(f.removed, pattern));
    if (added > removed) findings.push({ guard: 'suppression', file: where?.path, detail: `Adds a ${name}.` });
  }
  const added = diff.reduce((sum, f) => sum + f.added.length, 0);
  const removed = diff.reduce((sum, f) => sum + f.removed.length, 0);
  if (diff.length > rules.maxFiles)
    findings.push({ guard: 'size', detail: `Changes ${diff.length} files; the limit is ${rules.maxFiles}.` });
  if (added + removed > rules.maxLines)
    findings.push({ guard: 'size', detail: `Changes ${added + removed} lines; the limit is ${rules.maxLines}.` });
  const testsBefore = diff.reduce((sum, f) => sum + count(f.removed, TEST_CASE), 0);
  const testsAfter = diff.reduce((sum, f) => sum + count(f.added, TEST_CASE), 0);
  if (testsAfter < testsBefore)
    findings.push({
      guard: 'tests-kept',
      detail: `Removes ${testsBefore - testsAfter} test case(s). Tests may move, never go.`,
    });
  return findings;
}

export function diffStat(diff: ChangedFile[]): { files: number; added: number; removed: number } {
  return {
    files: diff.length,
    added: diff.reduce((sum, f) => sum + f.added.length, 0),
    removed: diff.reduce((sum, f) => sum + f.removed.length, 0),
  };
}
