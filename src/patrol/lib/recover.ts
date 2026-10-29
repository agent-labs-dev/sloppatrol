import type { LoadedConfig } from '../../config/index.js';
import { removeWorktree } from '../../git/index.js';
import type { PatrolDeps } from './deps.js';

/**
 * Work a stopped Sloppatrol left behind. Only one patrol runs at a time (the
 * lock), so anything still `working` or `running` now was interrupted.
 */
export async function recoverInterrupted(loaded: LoadedConfig, deps: PatrolDeps): Promise<void> {
  const now = new Date().toISOString();
  for (const refactor of await deps.store.listRefactors()) {
    if (refactor.status !== 'working') continue;
    await removeWorktree(loaded.source, refactor.worktree, refactor.branch);
    await deps.store.saveRefactor({
      ...refactor,
      status: 'failed',
      reason: 'Interrupted: Sloppatrol stopped.',
      updatedAt: now,
    });
  }
  for (const run of await deps.store.listCheckRuns()) {
    if (run.status === 'running')
      await deps.store.saveCheckRun({ ...run, status: 'failed', current: undefined, finishedAt: now });
  }
}
