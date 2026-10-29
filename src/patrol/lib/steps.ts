import type { LoadedConfig } from '../../config/index.js';
import type { Opportunity, Refactor, Scorecard } from '../../domain/index.js';
import { listFiles } from '../../git/index.js';
import { type SurveyResult, survey } from '../../roles/index.js';
import { attempt } from './attempt.js';
import { type Base, openBase, roleContext } from './base.js';
import type { PatrolDeps } from './deps.js';
import { exclusive } from './lock.js';
import { pickOpportunities } from './pick.js';
import { retireInvalid } from './retire.js';
import { scorecardFor } from './scorecard.js';

/** One step of the cycle, run by hand. Each needs green checks on the base. */
async function readyBase(loaded: LoadedConfig, deps: PatrolDeps): Promise<Base> {
  const base = await openBase(loaded, deps);
  if (base.blocked) throw new Error(base.blocked);
  return base;
}

/** Runs one survey now, whatever the backlog. */
export function surveyNow(loaded: LoadedConfig, deps: PatrolDeps): Promise<SurveyResult> {
  return exclusive(loaded, deps, async () => {
    const base = await readyBase(loaded, deps);
    const { ctx, census } = await roleContext(loaded, deps, base);
    const scorecard = loaded.config.metrics.enabled
      ? await scorecardFor(ctx, { dir: base.dir, sha: base.sha, census })
      : undefined;
    const result = await survey(ctx, { dir: base.dir, sha: base.sha, census, scorecard });
    await deps.store.savePatrolState({ ...(await deps.store.patrolState()), surveyedSha: base.sha });
    return result;
  });
}

/** One attempt now: at the opportunity `id`, or at the best open one. */
export function refactorNow(loaded: LoadedConfig, deps: PatrolDeps, id?: string): Promise<Refactor> {
  return exclusive(loaded, deps, async () => {
    const base = await readyBase(loaded, deps);
    await retireInvalid(loaded, deps, await listFiles(base.dir));
    const all = await deps.store.listOpportunities();
    let opportunity: Opportunity | undefined;
    if (id) {
      opportunity = all.find((o) => o.id === id);
      if (!opportunity) throw new Error(`Unknown opportunity ${id}.`);
      if (opportunity.status !== 'open')
        throw new Error(
          `${id} is ${opportunity.status}, not open${opportunity.reason ? `: ${opportunity.reason}` : '.'}`,
        );
    } else {
      // A manual step does not wait for open pull requests, but it never takes an
      // opportunity whose files a verified refactor already changes.
      const refactors = await deps.store.listRefactors();
      opportunity = pickOpportunities(all, refactors, { count: 1, maxOpen: Number.POSITIVE_INFINITY })[0];
      if (!opportunity) throw new Error('No open opportunity. Run `sloppatrol survey` first.');
    }
    const { ctx } = await roleContext(loaded, deps, base);
    return attempt(ctx, opportunity, base);
  });
}

/** The scorecard of the patrolled commit now, with up to `budget` more files scored. */
export function scoreNow(loaded: LoadedConfig, deps: PatrolDeps, budget?: number): Promise<Scorecard> {
  return exclusive(loaded, deps, async () => {
    const base = await readyBase(loaded, deps);
    const { ctx, census } = await roleContext(loaded, deps, base);
    return scorecardFor(ctx, { dir: base.dir, sha: base.sha, census, budget });
  });
}
