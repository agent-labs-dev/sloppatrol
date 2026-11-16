import { existsSync } from 'node:fs';
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { LoadedConfig } from '../../config/index.js';
import { type Opportunity, type Refactor, titleOf } from '../../domain/index.js';
import { git, removeWorktree } from '../../git/index.js';
import type { PatrolDeps } from './deps.js';
import { proofMarkdown } from './proof-text.js';

const FOOTER =
  '\n\n---\n_Opened by [Sloppatrol](https://github.com/agent-labs-dev/sloppatrol). The proof above was built by code and by a blind assessor, not by the agent that wrote the change. Close it to dismiss; Sloppatrol will not propose it again._';

function pullRequestBody(opportunity: Opportunity, refactor: Refactor): string {
  return [
    `**${opportunity.kind}**: ${opportunity.change}`,
    `## Why\n\n${opportunity.problem}\n\n${opportunity.benefits}`,
    refactor.summary ? `## What changed\n\n${refactor.summary}` : '',
    refactor.proof ? `## Proof\n\n${proofMarkdown(refactor.proof)}` : '',
    refactor.verdict?.review ? `## Review\n\n${refactor.verdict.review.reasons}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Move persisted active checkouts without changing their branch or commits. */
async function migrateWorktree(loaded: LoadedConfig, deps: PatrolDeps, refactor: Refactor): Promise<void> {
  const legacy = deps.store.path('worktrees', refactor.id);
  if (resolve(refactor.worktree) !== resolve(legacy) || !existsSync(legacy)) return;
  const destination = deps.store.workspacePath('worktrees', refactor.id);
  if (resolve(destination) === resolve(legacy)) return;
  await mkdir(dirname(destination), { recursive: true });
  // The legacy checkout is the complete source of truth. A destination left
  // by an interrupted copy may have valid Git metadata but missing files, so
  // never repair it in place or delete the only complete checkout.
  if (existsSync(destination)) await rm(destination, { recursive: true, force: true });
  await cp(legacy, destination, { recursive: true, force: false, errorOnExist: true });
  await git(loaded.source, ['worktree', 'repair', destination]);
  refactor.worktree = destination;
  await deps.store.saveRefactor(refactor);
  await rm(legacy, { recursive: true });
}

/** verified: how many verified refactors this run found to publish. */
export type Published = { urls: string[]; errors: string[]; dryRun: boolean; verified: number };

/** Opens a pull request for each verified refactor. Without GitHub, it prints them. */
export async function publish(loaded: LoadedConfig, deps: PatrolDeps, dryRun?: boolean): Promise<Published> {
  const settings = loaded.config.github;
  const result: Published = { urls: [], errors: [], dryRun: dryRun ?? !settings.enabled, verified: 0 };
  for (const refactor of await deps.store.listRefactors()) {
    if (refactor.status !== 'verified') continue;
    const opportunity = await deps.store.getOpportunity(refactor.opportunityId);
    if (!opportunity) continue;
    result.verified += 1;
    const title = titleOf(opportunity);
    const body = pullRequestBody(opportunity, refactor) + FOOTER;
    try {
      await migrateWorktree(loaded, deps, refactor);
      if (result.dryRun) {
        deps.log(`[dry run] pull request from ${refactor.branch}: ${title}\n${body}\n`);
        continue;
      }
      const url = await deps.github.openPullRequest({
        worktree: refactor.worktree,
        branch: refactor.branch,
        title,
        body,
        draft: settings.draft,
        labels: settings.labels,
      });
      const now = new Date().toISOString();
      await deps.store.saveRefactor({ ...refactor, status: 'published', prUrl: url, updatedAt: now });
      await deps.store.saveOpportunity({ ...opportunity, status: 'proposed', updatedAt: now });
      result.urls.push(url);
    } catch (error) {
      result.errors.push(`${refactor.id}: ${(error as Error).message}`);
    }
  }
  return result;
}

/**
 * GitHub wins: a merged pull request finishes its opportunity, a closed one
 * dismisses it for good.
 */
export async function syncGithub(loaded: LoadedConfig, deps: PatrolDeps): Promise<void> {
  for (const refactor of await deps.store.listRefactors()) {
    if (refactor.status !== 'published' || !refactor.prUrl) continue;
    await migrateWorktree(loaded, deps, refactor);
    let state: string;
    try {
      state = await deps.github.pullRequestState(refactor.prUrl);
    } catch {
      continue; // offline or no access: try again next cycle
    }
    if (state === 'open') continue;
    const now = new Date().toISOString();
    const merged = state === 'merged';
    await deps.store.saveRefactor({ ...refactor, status: merged ? 'merged' : 'closed', updatedAt: now });
    const opportunity = await deps.store.getOpportunity(refactor.opportunityId);
    if (opportunity)
      await deps.store.saveOpportunity({
        ...opportunity,
        status: merged ? 'done' : 'dismissed',
        reason: merged ? undefined : 'Its pull request was closed.',
        updatedAt: now,
      });
    await removeWorktree(loaded.source, refactor.worktree, refactor.branch);
  }
}
