import type { LoadedConfig } from '../../config/index.js';
import type { Refactor } from '../../domain/index.js';
import { listFiles } from '../../git/index.js';
import { survey } from '../../roles/index.js';
import { attempt } from './attempt.js';
import { openBase, roleContext } from './base.js';
import type { PatrolDeps } from './deps.js';
import { pickOpportunities } from './pick.js';
import { publish, syncGithub } from './publish.js';
import { retireInvalid } from './retire.js';
import { scorecardFor } from './scorecard.js';

export type CycleResult = {
  sha: string;
  /** Why the cycle did no work, when it did none. */
  blocked?: string;
  surveyed: number;
  refactors: Refactor[];
  published: string[];
};

/**
 * One patrol cycle on the patrolled ref: the checks must pass there first,
 * then the surveyor fills the backlog, the refactorer attempts the best
 * opportunities, and verified refactors become pull requests.
 */
export async function cycle(loaded: LoadedConfig, deps: PatrolDeps): Promise<CycleResult> {
  const { config } = loaded;
  const { store, log } = deps;
  await syncGithub(loaded, deps);
  const base = await openBase(loaded, deps);
  const result: CycleResult = { sha: base.sha, surveyed: 0, refactors: [], published: [] };
  if (base.blocked) {
    log(base.blocked);
    return { ...result, blocked: base.blocked };
  }
  const { ctx, census } = await roleContext(loaded, deps, base);
  const scorecard = config.metrics.enabled
    ? await scorecardFor(ctx, { dir: base.dir, sha: base.sha, census })
    : undefined;
  await retireInvalid(loaded, deps, await listFiles(base.dir));

  const state = await store.patrolState();
  const open = (await store.listOpportunities()).filter((o) => o.status === 'open');
  const surveyor = config.agents.surveyor;
  if (surveyor.enabled && open.length < surveyor.minBacklog && state.surveyedSha !== base.sha) {
    result.surveyed = (await survey(ctx, { dir: base.dir, sha: base.sha, census, scorecard })).recorded.length;
    await store.savePatrolState({ ...(await store.patrolState()), surveyedSha: base.sha });
  }

  if (config.agents.refactorer.enabled) {
    const picked = pickOpportunities(await store.listOpportunities(), await store.listRefactors(), {
      count: config.agents.refactorer.maxPerCycle,
      maxOpen: config.github.maxOpen,
    });
    for (const opportunity of picked) {
      const refactor = await attempt(ctx, opportunity, base);
      const why = refactor.reason ? ` - ${refactor.reason.split('\n')[0]}` : '';
      log(`refactor ${refactor.id} (${opportunity.title}): ${refactor.status}${why}`);
      result.refactors.push(refactor);
    }
  }

  const published = await publish(loaded, deps);
  result.published = published.urls;
  for (const error of published.errors) log(`publish failed: ${error}`);
  const latest = await store.patrolState();
  await store.savePatrolState({
    ...latest,
    lastSha: base.sha,
    lastCycleAt: new Date().toISOString(),
    cycles: latest.cycles + 1,
  });
  return result;
}
