import { readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import type { GuardFinding } from '../../domain/index.js';
import { git, tryGit } from '../../git/index.js';
import { matchesAny } from '../../globs/index.js';
import type { ChangedFile } from './diff.js';

type BudgetLimits = {
  /** A file may not end longer than this, or than it was at base when it was longer already. */
  fileLines: number;
  /** A folder may not hold more source files directly than this, or than it did at base. */
  dirFiles: number;
};

/** One changed file's length at base (under its old path, for a rename) and in the worktree. */
type FileLength = { path: string; base: number; head: number };

/** One folder that holds a changed file: its direct source files at base and in the worktree. */
type DirWidth = { dir: string; base: number; head: number };

type Sizes = { files: FileLength[]; dirs: DirWidth[] };

const COMMENT = /^\s*(\/\/|#(?![![])|\/\*|\*(?!\*)|--\s|""")/;
const NOT_COUNTED = /\bTODO\b|eslint-disable|biome-ignore|@ts-|# type: ignore|# noqa|nolint|@license|SPDX-/;
const PROSE = new Set(['.md', '.mdx', '.markdown', '.rst', '.txt', '.adoc']);

function lineCount(text: string): number {
  return text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function commentLines(lines: string[]): number {
  return lines.filter((line) => COMMENT.test(line) && !NOT_COUNTED.test(line)).length;
}

/**
 * Budgets, not limits: a refactor may leave a long file or a wide folder as
 * it found it, but never make one, or make one worse. A move or a split is
 * free: a renamed file keeps its old length as its budget, and comment lines
 * count over the whole diff, so a comment that moves with its code costs nothing.
 */
export function checkBudgets(diff: ChangedFile[], sizes: Sizes, limits: BudgetLimits): GuardFinding[] {
  const findings: GuardFinding[] = [];
  for (const file of sizes.files) {
    const budget = Math.max(limits.fileLines, file.base);
    if (file.head > budget)
      findings.push({
        guard: 'file-length',
        file: file.path,
        detail: `Ends at ${file.head} lines; its budget is ${budget}. Split it by concept into a folder instead of growing it.`,
      });
  }
  for (const dir of sizes.dirs) {
    const budget = Math.max(limits.dirFiles, dir.base);
    if (dir.head > budget)
      findings.push({
        guard: 'dir-width',
        file: `${dir.dir}/`,
        detail: `Holds ${dir.head} source files; its budget is ${budget}. Put the new files in a folder for their concept.`,
      });
  }
  const code = diff.filter((f) => !PROSE.has(extname(f.path).toLowerCase()));
  const added = code.reduce((sum, f) => sum + commentLines(f.added), 0);
  const removed = code.reduce((sum, f) => sum + commentLines(f.removed), 0);
  if (added > removed)
    findings.push({
      guard: 'comments',
      detail: `Adds ${added - removed} comment line(s) on balance. Say it with a name or a type, then delete the comment.`,
    });
  return findings;
}

async function baseText(worktree: string, baseSha: string, path: string): Promise<string> {
  return (await tryGit(worktree, ['show', `${baseSha}:${path}`])) ?? '';
}

async function headText(worktree: string, path: string): Promise<string | undefined> {
  return readFile(join(worktree, path), 'utf8').catch(() => undefined);
}

function directSourceFiles(listing: string, dir: string, tests: readonly string[]): number {
  const prefix = dir === '.' ? '' : `${dir}/`;
  return listing
    .split('\n')
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .filter((path) => path && !matchesAny(path, tests)).length;
}

/** Reads the lengths and widths the budgets judge. The worktree's index must hold the change (see `readDiff`). */
export async function measureSizes(
  worktree: string,
  baseSha: string,
  diff: ChangedFile[],
  tests: readonly string[],
): Promise<Sizes> {
  const files: FileLength[] = [];
  for (const file of diff) {
    const head = await headText(worktree, file.path);
    if (head === undefined) continue;
    files.push({
      path: file.path,
      base: lineCount(await baseText(worktree, baseSha, file.oldPath ?? file.path)),
      head: lineCount(head),
    });
  }
  const touched = new Set(files.filter((f) => !matchesAny(f.path, tests)).map((f) => dirname(f.path)));
  const dirs: DirWidth[] = [];
  if (touched.size) {
    const baseListing = await git(worktree, ['ls-tree', '-r', '--name-only', baseSha]);
    const headListing = await git(worktree, ['ls-files', '--cached']);
    for (const dir of touched)
      dirs.push({
        dir,
        base: directSourceFiles(baseListing, dir, tests),
        head: directSourceFiles(headListing, dir, tests),
      });
  }
  return { files, dirs };
}
