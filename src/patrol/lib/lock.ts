import { existsSync } from 'node:fs';
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
  if (existsSync(file)) {
    const pid = Number(await readFile(file, 'utf8'));
    let alive = false;
    try {
      process.kill(pid, 0);
      alive = pid !== process.pid;
    } catch {
      /* a stale lock */
    }
    if (alive) throw new Error(`Another Sloppatrol process works on this repo (pid ${pid}).`);
  }
  await writeFile(file, String(process.pid));
  try {
    await recoverInterrupted(loaded, deps);
    return await work();
  } finally {
    await rm(file, { force: true });
  }
}
