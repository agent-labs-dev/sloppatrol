import { git } from '../../git/index.js';

export type ChangedFile = {
  path: string;
  /** Set when the file was renamed or deleted. */
  oldPath?: string;
  added: string[];
  removed: string[];
};

/**
 * Everything in the worktree since `baseSha`, staged first so that new
 * files count. Renames are detected, so a moved file costs only the lines
 * that really changed.
 */
export async function readDiff(worktree: string, baseSha: string): Promise<ChangedFile[]> {
  await git(worktree, ['add', '-A']);
  const patch = await git(worktree, ['diff', '--cached', '-M', '-U0', '--no-color', '--no-ext-diff', baseSha]);
  const files: ChangedFile[] = [];
  let current: ChangedFile | undefined;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      current = { path: match?.[2] ?? '', added: [], removed: [] };
      if (match && match[1] !== match[2]) current.oldPath = match[1];
      files.push(current);
    } else if (!current || line.startsWith('+++ ') || line.startsWith('--- ')) {
      if (current && line === '+++ /dev/null') current.oldPath = current.path;
    } else if (line.startsWith('+')) current.added.push(line.slice(1));
    else if (line.startsWith('-')) current.removed.push(line.slice(1));
  }
  return files;
}
