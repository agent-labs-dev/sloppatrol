import type { Guardrail } from '../domain/index.js';
import { listFiles } from '../git/index.js';
import { matchesAny } from '../globs/index.js';
import { detectGuardrails } from './lib/guardrails.js';
import { type Navigation, navigable, navigationOf } from './lib/navigation.js';
import { type Churn, churn, type FileSize, type MockUse, measureFiles, readCapped } from './lib/signals.js';
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
  navigation: Navigation;
};

export type CensusScope = { tests: readonly string[]; focus: readonly string[]; ignore: readonly string[] };

export async function takeCensus(root: string, scope: CensusScope): Promise<Census> {
  const all = await listFiles(root);
  const wanted = (path: string) =>
    !matchesAny(path, scope.ignore) && (scope.focus.length === 0 || matchesAny(path, scope.focus));
  const inScope = (path: string) => Boolean(languageOf(path)) && wanted(path);
  const code = all.filter(inScope);
  // Generated files can outnumber the real code, so they do not decide the main language.
  const kept = all.filter((path) => !matchesAny(path, scope.ignore));
  const tests = code.filter((path) => matchesAny(path, scope.tests));
  const sources = code.filter((path) => !matchesAny(path, scope.tests));
  const [stack, measured, hot, navigation] = await Promise.all([
    detectStack(root, kept),
    measureFiles(root, sources, tests),
    churn(root, inScope),
    navigate(
      root,
      all.filter((path) => navigable(path) && wanted(path)),
      scope.tests,
    ),
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
    navigation,
  };
}

async function navigate(root: string, paths: string[], tests: readonly string[]): Promise<Navigation> {
  const texts = new Map<string, string>();
  for (const path of paths) {
    const body = await readCapped(root, path);
    if (body !== undefined) texts.set(path, body);
  }
  return navigationOf(texts, (path) => !matchesAny(path, tests));
}

/** The files with the most hits first, a few names each. */
function byFile<T extends { path: string }>(items: T[], name: (item: T) => string, files = 15, each = 5): string[] {
  const groups = new Map<string, T[]>();
  for (const item of items) groups.set(item.path, [...(groups.get(item.path) ?? []), item]);
  return [...groups]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, files)
    .map(
      ([path, hits]) =>
        `- ${path}: ${hits.slice(0, each).map(name).join(', ')}${hits.length > each ? `, and ${hits.length - each} more` : ''}`,
    );
}

export function censusMarkdown(census: Census): string {
  const { stack, navigation } = census;
  const list = <T>(items: T[], line: (item: T) => string) => (items.length ? items.map(line).join('\n') : '- none');
  const fanIn = new Map(navigation.fanIn.map((f) => [f.path, f.importers]));
  const importedBy = (path: string) => (fanIn.has(path) ? `, imported by ${fanIn.get(path)}` : '');
  const lines = (items: string[]) => (items.length ? items.join('\n') : '- none');
  return [
    '# Census',
    `Languages: ${stack.languages.map((l) => `${l.name} (${l.files} files, ${l.lines} lines)`).join(', ') || 'none found'}`,
    `Frameworks: ${stack.frameworks.join(', ') || 'none found'}`,
    `Project kind: ${stack.kinds.join(', ')}`,
    `Files: ${census.sourceFiles} source, ${census.testFiles} test`,
    '## Guardrails (what turns a wrong edit into a failed check)',
    list(census.guardrails, (g) => `- ${g.present ? '✓' : '✗'} ${g.name}: ${g.evidence}`),
    '## Largest source files (lines)',
    list(census.largest, (f) => `- ${f.path}: ${f.lines}${importedBy(f.path)}`),
    '## Tests that use a mocking library',
    list(census.mocks, (m) => `- ${m.path}: ${m.count} uses, e.g. \`${m.sample}\``),
    '## Most changed files (last 300 commits)',
    list(census.churn.slice(0, 20), (c) => `- ${c.path}: ${c.commits} commits${importedBy(c.path)}`),
    '## Navigation aids: where to look, not evidence',
    'Found by regex for TypeScript, JavaScript, Python and Lua, without a model. They miss dynamic and aliased imports and names built from strings, and count names in comments and strings. Read the code before you record anything they point at.',
    '### Most imported files (fan-in)',
    list(navigation.fanIn.slice(0, 15), (f) => `- ${f.path}: imported by ${f.importers}`),
    '### Functions that only forward their parameters to one call (pass-through)',
    lines(byFile(navigation.passThroughs, (p) => `${p.name} (line ${p.line}) → ${p.callee}`)),
    '### Top-level symbols named once elsewhere (one use)',
    lines(byFile(navigation.usedOnce, (u) => `${u.name} (line ${u.line})`)),
  ].join('\n\n');
}
