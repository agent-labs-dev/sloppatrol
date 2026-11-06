import {
  type GateVerdict,
  gainOf,
  type Mutation,
  type Opportunity,
  type Proof,
  type Refactor,
} from '../../domain/index.js';
import { checksKey, guardRulesFor, inspectChange, runRecordedChecks, testsPassed } from '../../gate/index.js';
import { type RoleContext, review } from '../../roles/index.js';
import { changedFiles, improvementProof, mutationProof } from './proof.js';
import { proofMarkdown } from './proof-text.js';

export type Judgement = Pick<Refactor, 'status' | 'reason' | 'verdict' | 'proof' | 'diffStat'>;

const GUARDS = ['one side', 'no frozen file', 'no suppression', 'no test removed', 'within the size limit'];

/**
 * The gate on a committed refactor, in order: guards, checks, the mutation
 * (tests refactors), the blind improvement score, then the reviewer's veto.
 * Each step that fails rejects; `save` records the proof as it grows.
 */
export async function judge(
  ctx: RoleContext,
  input: { refactor: Refactor; opportunity: Opportunity; mutation?: Mutation; baseDir: string },
  save: (patch: Partial<Refactor>) => Promise<unknown>,
): Promise<Judgement> {
  const { config } = ctx.loaded;
  const { refactor, opportunity } = input;
  const { worktree, baseSha, id, branch } = refactor;
  const reject = (reason: string, verdict: GateVerdict, proof?: Proof): Judgement => ({
    status: 'rejected',
    reason,
    verdict,
    proof,
  });

  const inspection = await inspectChange(worktree, baseSha, guardRulesFor(config, opportunity.side));
  await save({ diffStat: inspection.stat });
  if (inspection.findings.length)
    return {
      ...reject(inspection.findings[0]!.detail, { passed: false, guards: inspection.findings, checks: [] }),
      diffStat: inspection.stat,
    };

  await ctx.store.setStatus({ role: 'gate', state: 'running', detail: `Checks on ${branch}` });
  const run = await runRecordedChecks(
    ctx.store,
    { purpose: 'gate', sha: baseSha, refactorId: id, branch },
    config.checks,
    worktree,
    ctx.log,
  );
  const verdict: GateVerdict = { passed: false, guards: [], checks: run.results, checkRunId: run.id };
  const base = await ctx.store.baseCheckRun(baseSha, checksKey(config.checks));
  const proof: Proof = {
    behaviour: {
      side: opportunity.side,
      guards: GUARDS,
      baseRunId: base?.id,
      headRunId: run.id,
      testsBase: base ? testsPassed(base.results) : undefined,
      testsHead: testsPassed(run.results),
    },
  };
  if (run.status !== 'passed') {
    const failed = run.results.find((c) => !c.ok)?.name ?? 'a check';
    await ctx.store.setStatus({ role: 'gate', state: 'done', detail: `${failed} failed on ${branch}` });
    return reject(`The check ${failed} failed.`, verdict, proof);
  }
  await ctx.store.setStatus({ role: 'gate', state: 'done', detail: `Checks passed on ${branch}` });
  await save({ verdict, proof });

  if (opportunity.side === 'tests') {
    if (!input.mutation) return reject('No mutation: nothing shows the new tests can fail.', verdict, proof);
    const mutation = input.mutation;
    await ctx.store.setStatus({ role: 'gate', state: 'running', detail: `Mutation on ${branch}` });
    const after = await mutationProof(ctx, { dir: worktree, mutation, sha: baseSha, refactorId: id, branch });
    proof.behaviour.mutation = { ...mutation, ...after };
    await save({ proof });
    if (!after.caught)
      return reject('The tests did not catch the planted bug: they cannot fail where it matters.', verdict, proof);
    if (gainOf(opportunity.kind) === 'coverage') {
      // New coverage: the same bug must slip past the old tests on main.
      const before = await mutationProof(ctx, {
        dir: input.baseDir,
        mutation,
        sha: baseSha,
        refactorId: id,
        branch: 'main',
      });
      proof.behaviour.mutation = {
        ...proof.behaviour.mutation,
        caughtBefore: before.caught,
        beforeRunId: before.runId,
      };
      await save({ proof });
      if (before.caught)
        return reject(
          'The old tests already catch the planted bug: the new tests add no proven coverage.',
          verdict,
          proof,
        );
    }
    await ctx.store.setStatus({ role: 'gate', state: 'done', detail: `Mutation caught on ${branch}` });
  }

  if (config.metrics.enabled) {
    const changed = await changedFiles(worktree, baseSha);
    proof.improvement = await improvementProof(ctx, { worktree, baseSha, opportunity, changed, refactorId: id });
    await save({ proof });
    if (!proof.improvement.improved) return reject(proof.improvement.reason, verdict, proof);
  }

  if (config.agents.reviewer.enabled) {
    const decision = await review(ctx, {
      opportunity,
      worktree,
      baseSha,
      refactorId: id,
      verdict,
      proof: proofMarkdown(proof),
    });
    proof.rules = { sources: (await ctx.rules(opportunity.files)).sources, compliance: decision.rules };
    verdict.review = decision;
    if (!decision.approve) return reject(decision.reasons, verdict, proof);
  }
  return { status: 'verified', verdict: { ...verdict, passed: true }, proof };
}
