import { editTools, finishTool, type RoleOutcome, repoTools, runRole, tool } from '../../agents/index.js';
import { resolveRuntime } from '../../config/index.js';
import type { Mutation, Opportunity } from '../../domain/index.js';
import { git } from '../../git/index.js';
import { changeTools } from './change-tools.js';
import { type RoleContext, systemPrompt } from './context.js';
import { REFACTORER, REFACTORER_COMPLETE, REFACTORER_TESTS } from './prompts.js';

export function opportunityMarkdown(opportunity: Opportunity): string {
  return [
    `# ${opportunity.title}`,
    `Kind: \`${opportunity.kind}\`. Side: ${opportunity.side} files only. Target metrics: ${(opportunity.metrics ?? []).join(', ') || 'none named'}.`,
    `Files: ${opportunity.files.map((f) => `\`${f}\``).join(', ')}`,
    `## Problem\n\n${opportunity.problem}`,
    `## Change\n\n${opportunity.change}`,
    `## Benefits\n\n${opportunity.benefits}`,
  ].join('\n\n');
}

/** Lets one refactorer session edit `worktree` to make the opportunity real. */
export async function refactor(
  ctx: RoleContext,
  input: { opportunity: Opportunity; worktree: string; baseSha: string; refactorId: string; branch: string },
): Promise<RoleOutcome & { mutation?: Mutation; timedOut?: boolean }> {
  const { config } = ctx.loaded;
  const { opportunity, worktree, baseSha } = input;
  const change = changeTools(ctx, input);
  const tools = [
    tool('get_opportunity', 'The opportunity to make real.', {}, [], async () => ({
      text: opportunityMarkdown(opportunity),
    })),
    ...change.tools,
    tool('git_diff', 'Your change so far.', {}, [], async () => {
      await git(worktree, ['add', '-A']);
      return { text: (await git(worktree, ['diff', '--cached', '-M', baseSha])) || 'No change yet.' };
    }),
    ...repoTools(worktree),
    ...editTools(worktree),
    finishTool('Finish with the pull request summary, or with the reason you changed nothing.'),
  ];
  const role = opportunity.side === 'tests' ? `${REFACTORER}\n\n${REFACTORER_TESTS}` : REFACTORER;
  const system = await systemPrompt(ctx, role, opportunity.files);
  const run = (prompt: string, limits: { maxSteps: number; timeoutMinutes: number }) =>
    runRole({
      role: 'refactorer',
      runtime: ctx.runtimeFor(resolveRuntime(config, 'refactorer')),
      system,
      prompt,
      tools,
      limits,
      subject: `refactor:${input.refactorId}`,
      workdir: worktree,
      store: ctx.store,
      log: ctx.log,
    });
  const first = await run(`Make this opportunity real.\n\n${opportunityMarkdown(opportunity)}`, {
    maxSteps: config.agents.refactorer.maxSteps,
    timeoutMinutes: config.agents.refactorer.timeoutMinutes,
  });
  let outcome = first;
  const timedOut = first.stop === 'timeout';
  if (timedOut) {
    // The session ran out of time mid-edit. It hands its worktree to one bounded
    // completion session, so a half-finished change or its leftover imports are
    // finished instead of being committed and rejected by a check.
    ctx.log(`[refactorer] timed out after ${config.agents.refactorer.timeoutMinutes} min; running a completion pass`);
    await change.settle();
    outcome = await run(`${REFACTORER_COMPLETE}\n\n${opportunityMarkdown(opportunity)}`, {
      maxSteps: config.agents.refactorer.cleanupMaxSteps,
      timeoutMinutes: config.agents.refactorer.cleanupTimeoutMinutes,
    });
  }
  await change.settle();
  return { ...outcome, mutation: change.mutation(), timedOut };
}
