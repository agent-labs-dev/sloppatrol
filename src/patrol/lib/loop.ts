import type { LoadedConfig } from '../../config/index.js';
import { cycle } from './cycle.js';
import type { PatrolDeps } from './deps.js';
import { exclusive } from './lock.js';

/**
 * Runs cycles until stopped. The config is read again before each cycle,
 * so an edit applies without a restart.
 */
export async function patrol(
  load: () => Promise<LoadedConfig>,
  deps: PatrolDeps,
  options: { once?: boolean } = {},
): Promise<void> {
  await exclusive(await load(), deps, async () => {
    try {
      for (let count = 1; ; count++) {
        await deps.store.setStatus({ role: 'patrol', state: 'running', detail: `Cycle ${count}` });
        const loaded = await load();
        try {
          await cycle(loaded, deps);
        } catch (error) {
          deps.log(`cycle failed: ${(error as Error).message}`);
          if (options.once) throw error;
        }
        if (options.once) break;
        const minutes = loaded.config.patrol.intervalMinutes;
        await deps.store.setStatus({ role: 'patrol', state: 'idle', detail: `Next cycle in ${minutes} min` });
        await new Promise((done) => setTimeout(done, minutes * 60_000));
      }
    } finally {
      await deps.store.setStatus({ role: 'patrol', state: 'idle', detail: 'Stopped.' });
    }
  });
}
