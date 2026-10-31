import { newId, type Opportunity, type Refactor, titleOf } from '../../domain/index.js';
import { cleanup, prepare } from '../../gate/index.js';
import { addWorktree, git, removeWorktree, squashCommit } from '../../git/index.js';
import { type RoleContext, refactor } from '../../roles/index.js';
import { judge } from './judge.js';

/** The title without its conventional-commit type, as a branch name. */
function slug(text: string): string {
  return text
    .replace(/^[a-z]+(\([^)]*\))?!?: /, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/**
 * One attempt at one opportunity: a worktree, a refactorer session, one
 * commit, then the gate (`judge`). Only a verified refactor keeps its branch.
 */
export async function attempt(
  ctx: RoleContext,
  opportunity: Opportunity,
  base: { sha: string; dir: string },
): Promise<Refactor> {
  const baseSha = base.sha;
  const { config, source } = ctx.loaded;
  const { store, log } = ctx;
  const id = newId();
  const branch = `sloppatrol/${opportunity.kind}-${slug(opportunity.title)}-${id.slice(-4)}`;
  const worktree = store.path('worktrees', id);
  const now = () => new Date().toISOString();
  let current: Refactor = {
    id,
    opportunityId: opportunity.id,
    status: 'working',
    branch,
    worktree,
    baseSha,
    createdAt: now(),
    updatedAt: now(),
  };
  const save = async (patch: Partial<Refactor>): Promise<Refactor> => {
    current = { ...current, ...patch, updatedAt: now() };
    await store.saveRefactor(current);
    return current;
  };
  await save({});
  try {
    await addWorktree(source, worktree, branch, baseSha);
    await prepare(config.prepare, worktree, log);
    const outcome = await refactor(ctx, { opportunity, worktree, baseSha, refactorId: id, branch });
    if (outcome.stop === 'error') return await save({ status: 'failed', reason: outcome.error });
    // The deterministic tidy-up pass, before the gate looks at the change: a
    // session that ran out of time must not fail a check on residue it can
    // clear mechanically (an import its edit made unused).
    await cleanup(config.cleanup, worktree, log);
    const summary = outcome.summary ?? '';
    const committed = await squashCommit(worktree, baseSha, [
      titleOf(opportunity),
      `${summary}\n\nMade by Sloppatrol. The proof is in the pull request.`.trim(),
    ]);
    if (!committed) return await save({ status: 'rejected', summary, reason: `No change. ${summary}`.trim() });
    const head = await save({
      summary,
      headSha: await git(worktree, ['rev-parse', 'HEAD']),
      ...(outcome.timedOut ? { timedOut: true } : {}),
    });
    return await save(
      await judge(ctx, { refactor: head, opportunity, mutation: outcome.mutation, baseDir: base.dir }, save),
    );
  } catch (error) {
    return await save({ status: 'failed', reason: (error as Error).message.slice(0, 2000) });
  } finally {
    // Only a verified refactor keeps its worktree and branch, for the pull request.
    if (current.status !== 'verified') await removeWorktree(source, worktree, branch);
    await settleOpportunity(ctx, opportunity, current);
  }
}

async function settleOpportunity(ctx: RoleContext, opportunity: Opportunity, result: Refactor): Promise<void> {
  const attempts = opportunity.attempts + 1;
  const spent = result.status !== 'verified' && attempts >= ctx.loaded.config.agents.refactorer.maxAttempts;
  await ctx.store.saveOpportunity({
    ...opportunity,
    attempts,
    status: spent ? 'exhausted' : opportunity.status,
    reason: result.status === 'verified' ? undefined : result.reason,
    updatedAt: new Date().toISOString(),
  });
}
