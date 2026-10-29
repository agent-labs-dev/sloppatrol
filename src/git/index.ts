import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 });
  return stdout.trim();
}

export async function tryGit(cwd: string, args: string[]): Promise<string | undefined> {
  try {
    return await git(cwd, args);
  } catch {
    return undefined;
  }
}

/** Resolves a ref to a commit, after a fetch when the ref names a remote. */
export async function resolveRef(source: string, ref: string): Promise<string | undefined> {
  const remote = ref.includes('/') ? ref.split('/')[0] : undefined;
  if (remote && (await tryGit(source, ['remote']))) await tryGit(source, ['fetch', '--quiet', remote]);
  return tryGit(source, ['rev-parse', '--verify', `${ref}^{commit}`]);
}

/** A detached, read-only checkout of `sha`, reused when it exists. */
export async function checkout(source: string, dir: string, sha: string): Promise<void> {
  if (existsSync(dir)) return;
  await git(source, ['worktree', 'add', '--detach', dir, sha]);
}

/** A worktree on a new branch, for an agent to edit. */
export async function addWorktree(source: string, dir: string, branch: string, sha: string): Promise<void> {
  await git(source, ['worktree', 'add', '-b', branch, dir, sha]);
}

export async function removeWorktree(source: string, dir: string, branch?: string): Promise<void> {
  await tryGit(source, ['worktree', 'remove', '--force', dir]);
  if (branch) await tryGit(source, ['branch', '-D', branch]);
}

export async function listFiles(dir: string): Promise<string[]> {
  return ((await tryGit(dir, ['ls-files'])) ?? '').split('\n').filter(Boolean);
}

/**
 * Squashes everything in the worktree since `baseSha` (the agent's own
 * commits and its uncommitted edits) into one commit. Returns false when
 * nothing changed.
 */
export async function squashCommit(dir: string, baseSha: string, message: string[]): Promise<boolean> {
  await git(dir, ['add', '-A']);
  await git(dir, ['reset', '--soft', baseSha]);
  if (!(await tryGit(dir, ['diff', '--cached', '--name-only']))) return false;
  // The repo's own identity when it has one; a fresh CI runner or VM has none.
  const identity = (await tryGit(dir, ['config', 'user.email']))
    ? []
    : ['-c', 'user.name=Sloppatrol', '-c', 'user.email=sloppatrol@users.noreply.github.com'];
  const commit = ['commit', '-q', '--no-verify', ...message.flatMap((m) => ['-m', m])];
  // The repo's own signing setup first, so a repo that requires signed
  // commits gets one; a machine that cannot sign (no key, no agent) still commits.
  if ((await tryGit(dir, [...identity, ...commit])) === undefined)
    await git(dir, [...identity, '-c', 'commit.gpgsign=false', ...commit]);
  return true;
}
