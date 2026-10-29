import type { LoadedConfig } from '../../config/index.js';
import { matchesAny } from '../../globs/index.js';
import type { PatrolDeps } from './deps.js';

/**
 * Open opportunities that can no longer become a kept refactor: a file is
 * gone, or the config now forbids a change to it.
 */
export async function retireInvalid(loaded: LoadedConfig, deps: PatrolDeps, tracked: string[]): Promise<void> {
  const { config } = loaded;
  const files = new Set(tracked);
  for (const opportunity of await deps.store.listOpportunities()) {
    if (opportunity.status !== 'open') continue;
    const gone = opportunity.files.find((f) => !files.has(f));
    const ignored = opportunity.files.find((f) => matchesAny(f, config.ignore));
    const unchecked = opportunity.files.find((f) => matchesAny(f, config.uncheckedTests));
    const reason = gone
      ? `${gone} is gone on ${config.patrol.pull}.`
      : ignored
        ? `${ignored} is in ignore.`
        : unchecked
          ? `No check runs ${unchecked} (uncheckedTests).`
          : undefined;
    if (reason)
      await deps.store.saveOpportunity({
        ...opportunity,
        status: 'dismissed',
        reason,
        updatedAt: new Date().toISOString(),
      });
  }
}
