import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

async function read(root: string, file: string): Promise<string> {
  const path = join(root, file);
  return existsSync(path) ? readFile(path, 'utf8').catch(() => '') : '';
}

const HOOK = /^(\.husky\/pre-commit|\.githooks\/pre-commit|lefthook\.ya?ml|\.pre-commit-config\.yaml)$/;

/** What the hook runs, by command or hook id, in the order it runs them. */
function commands(file: string, text: string): string[] {
  if (file === '.pre-commit-config.yaml') return [...text.matchAll(/^\s*-\s*id:\s*(\S+)/gm)].map((m) => m[1] ?? '');
  if (/lefthook/.test(file)) return [...text.matchAll(/^\s*run:\s*(.+)$/gm)].map((m) => (m[1] ?? '').trim());
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !/^(\.\s|set\s|#!)/.test(l));
}

/** lint-staged's config: the `lint-staged` key of package.json, or its own rc file. */
async function lintStaged(root: string): Promise<string> {
  try {
    const pkg = JSON.parse((await read(root, 'package.json')) || '{}') as Record<string, unknown>;
    if (pkg['lint-staged']) return JSON.stringify(pkg['lint-staged']);
  } catch {
    /* a broken manifest has no lint-staged config to read */
  }
  return (await Promise.all(['.lintstagedrc', '.lintstagedrc.json'].map((f) => read(root, f)))).join('\n');
}

const TRAITS: [RegExp, string][] = [
  [/\b(vitest|jest|pytest|mocha|cargo (nextest|test)|go test|(pnpm|npm|yarn|bun)( run)? test)\b/, 'runs tests'],
  [/\b(cargo build|go build|(pnpm|npm|yarn|bun)( run)? build)\b/, 'runs a build'],
  [
    /--write\b|--fix\b|\bgit add\b|end-of-file-fixer|trailing-whitespace|ruff[- ]format|cargo fmt(?![^\n]*--check)|gofmt -w/,
    'rewrites files',
  ],
];

/**
 * A commit hook is shown, not scored. A fast hook that runs what CI runs
 * helps; a slow one, or one that rewrites files, gets skipped with
 * --no-verify or stalls an agent committing in a worktree. CI is the gate
 * that counts, so a missing hook is not a gap either.
 */
export async function describeCommitHook(
  root: string,
  files: string[],
): Promise<{ present: boolean; evidence: string }> {
  const hooks = files.filter((f) => HOOK.test(f));
  if (hooks.length === 0) return { present: false, evidence: 'No commit hook.' };
  const parts: string[] = [];
  let all = '';
  for (const file of hooks) {
    const text = await read(root, file);
    const run = commands(file, text);
    parts.push(`${file} runs ${run.length ? run.slice(0, 6).join(', ') : 'nothing found'}`);
    // lint-staged's own config decides what the hook does to staged files.
    all += `\n${text}\n${/lint-staged/.test(text) ? await lintStaged(root) : ''}`;
  }
  const traits = TRAITS.filter(([pattern]) => pattern.test(all)).map(([, trait]) => trait);
  const summary = traits.length ? `It ${traits.join(', ')}.` : 'Only checks, no tests, builds or rewrites found.';
  return { present: true, evidence: `${parts.join('; ')}. ${summary}` };
}
