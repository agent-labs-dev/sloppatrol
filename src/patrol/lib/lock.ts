import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import type { LoadedConfig } from '../../config/index.js';
import type { PatrolDeps } from './deps.js';
import { recoverInterrupted } from './recover.js';

/**
 * Runs `work` as the only Sloppatrol process on this store: a patrol and a
 * manual step never edit the same worktrees at once. Work an earlier,
 * stopped process left behind is cleaned up first.
 */
export async function exclusive<T>(loaded: LoadedConfig, deps: PatrolDeps, work: () => Promise<T>): Promise<T> {
  await mkdir(deps.store.root, { recursive: true });
  const file = deps.store.path('patrol.lock');
  // `wx` creates the lock only when no other process has: two patrols cannot both take it.
  while (!(await writeFile(file, String(process.pid), { flag: 'wx' }).then(() => true, lockTaken))) {
    const pid = Number(await readFile(file, 'utf8').catch(() => ''));
    // An empty lock is one another process is still writing.
    let alive = !(pid > 0);
    try {
      if (!alive) process.kill(pid, 0);
      alive ||= pid !== process.pid;
    } catch {
      /* a stale lock */
    }
    if (alive) throw new Error(`Another Sloppatrol process works on this repo (pid ${pid}).`);
    await rm(file, { force: true });
  }
  try {
    await recoverInterrupted(loaded, deps);
    return await work();
  } finally {
    await rm(file, { force: true });
  }
}

function lockTaken(error: NodeJS.ErrnoException): false {
  if (error.code !== 'EEXIST') throw error;
  return false;
}
