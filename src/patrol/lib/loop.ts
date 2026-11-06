import type { LoadedConfig } from '../../config/index.js';
import { type CycleResult, cycle } from './cycle.js';
import type { PatrolDeps } from './deps.js';
import { exclusive } from './lock.js';
import { deferral, isIdle, waitMinutes } from './schedule.js';

const sleep = (minutes: number) => new Promise((done) => setTimeout(done, minutes * 60_000));

/**
 * Runs cycles until stopped. The config is read again before each cycle,
 * so an edit applies without a restart. A cycle waits while the machine is
 * busy or the daily cap is reached; `once` then skips it and returns.
 */
export async function patrol(
  load: () => Promise<LoadedConfig>,
  deps: PatrolDeps,
  options: { once?: boolean } = {},
): Promise<void> {
  await exclusive(await load(), deps, async () => {
    try {
      let idleStreak = 0;
      for (let count = 1; ; ) {
        const loaded = await load();
        const settings = loaded.config.patrol;
        const wait = deferral(
          settings,
          (await deps.store.listCycles()).map((c) => c.startedAt),
        );
        if (wait) {
          deps.log(`skipping a cycle: ${wait.reason}`);
          if (options.once) break;
          await deps.store.setStatus({
            role: 'patrol',
            state: 'idle',
            detail: `Waiting ${wait.minutes} min: ${wait.reason}`,
          });
          await sleep(wait.minutes);
          continue;
        }
        await deps.store.setStatus({ role: 'patrol', state: 'running', detail: `Cycle ${count++}` });
        let result: CycleResult | undefined;
        try {
          result = await cycle(loaded, deps);
        } catch (error) {
          deps.log(`cycle failed: ${(error as Error).message}`);
          if (options.once) throw error;
        }
        if (options.once) break;
        idleStreak = isIdle(result) ? idleStreak + 1 : 0;
        const minutes = waitMinutes(settings, idleStreak);
        await deps.store.setStatus({ role: 'patrol', state: 'idle', detail: `Next cycle in ${minutes} min` });
        await sleep(minutes);
      }
    } finally {
      await deps.store.setStatus({ role: 'patrol', state: 'idle', detail: 'Stopped.' });
    }
  });
}
