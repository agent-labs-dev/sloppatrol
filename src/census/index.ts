import type { Guardrail } from '../domain/index.js';
import { listFiles } from '../git/index.js';
import { matchesAny } from '../globs/index.js';
import { detectGuardrails } from './lib/guardrails.js';
import { type Churn, churn, type FileSize, type MockUse, measureFiles } from './lib/signals.js';
import { detectStack, languageOf, type Stack } from './lib/stack.js';

export type { Stack };

/** Facts about the repo, measured by code. The surveyor starts from these. */
export type Census = {
  stack: Stack;
  /** Every code file in scope: the whole population a scorecard can cover. */
  files: string[];
  guardrails: Guardrail[];
  sourceFiles: number;
  testFiles: number;
  largest: FileSize[];
  mocks: MockUse[];
  churn: Churn[];
};

export type CensusScope = { tests: readonly string[]; focus: readonly string[]; ignore: readonly string[] };

export async function takeCensus(root: string, scope: CensusScope): Promise<Census> {
  const all = await listFiles(root);
  const inScope = (path: string) =>
    Boolean(languageOf(path)) &&
    !matchesAny(path, scope.ignore) &&
    (scope.focus.length === 0 || matchesAny(path, scope.focus));
  const code = all.filter(inScope);
  const tests = code.filter((path) => matchesAny(path, scope.tests));
  const sources = code.filter((path) => !matchesAny(path, scope.tests));
  const [stack, measured, hot] = await Promise.all([
    detectStack(root, all),
    measureFiles(root, sources, tests),
    churn(root, inScope),
  ]);
  const guardrails = await detectGuardrails(root, all, stack, tests.length);
  return {
    stack,
    guardrails,
    files: code,
    sourceFiles: sources.length,
    testFiles: tests.length,
    ...measured,
    churn: hot,
  };
}

export function censusMarkdown(census: Census): string {
  const { stack } = census;
  const list = <T>(items: T[], line: (item: T) => string) => (items.length ? items.map(line).join('\n') : '- none');
  return [
    '# Census',
    `Languages: ${stack.languages.map((l) => `${l.name} (${l.files} files)`).join(', ') || 'none found'}`,
    `Frameworks: ${stack.frameworks.join(', ') || 'none found'}`,
    `Project kind: ${stack.kinds.join(', ')}`,
    `Files: ${census.sourceFiles} source, ${census.testFiles} test`,
    '## Guardrails (what turns a wrong edit into a failed check)',
    list(census.guardrails, (g) => `- ${g.present ? '✓' : '✗'} ${g.name}: ${g.evidence}`),
    '## Largest source files (lines)',
    list(census.largest, (f) => `- ${f.path}: ${f.lines}`),
    '## Tests that use a mocking library',
    list(census.mocks, (m) => `- ${m.path}: ${m.count} uses, e.g. \`${m.sample}\``),
    '## Most changed files (last 300 commits)',
    list(census.churn.slice(0, 20), (c) => `- ${c.path}: ${c.commits} commits`),
  ].join('\n\n');
}
