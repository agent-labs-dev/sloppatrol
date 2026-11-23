import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { git, tryGit } from '../../git/index.js';
import { codeWithoutComments } from './comments.js';

const PROSE = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc']);

/**
 * True when every code file the change touches has the same code at base and
 * in the worktree once comments and blank lines are gone: the change edited
 * comments and prose only, so no behaviour can differ. A new, deleted or
 * renamed code file, or one in a language whose comments it cannot find, makes it false.
 */
export async function codeUnchanged(worktree: string, baseSha: string): Promise<boolean> {
  const status = await git(worktree, ['diff', '--name-status', '--no-renames', baseSha, 'HEAD']);
  const changed = status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, path]) => path && !PROSE.has(extname(path).toLowerCase()));
  if (!changed.length) return false;
  for (const [kind, path] of changed) {
    if (kind !== 'M' || !path) return false;
    const base = await tryGit(worktree, ['show', `${baseSha}:${path}`]);
    const head = await readFile(join(worktree, path), 'utf8').catch(() => undefined);
    if (base === undefined || head === undefined) return false;
    const before = codeWithoutComments(path, base);
    if (before === undefined || before !== codeWithoutComments(path, head)) return false;
  }
  return true;
}
