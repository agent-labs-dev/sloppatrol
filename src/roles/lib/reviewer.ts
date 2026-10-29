import { repoTools, runRole, str, tool } from '../../agents/index.js';
import { resolveRuntime } from '../../config/index.js';
import type { GateVerdict, Opportunity, Review } from '../../domain/index.js';
import { verdictMarkdown } from '../../gate/index.js';
import { git } from '../../git/index.js';
import { type RoleContext, systemPrompt } from './context.js';
import { REVIEWER } from './prompts.js';
import { opportunityMarkdown } from './refactorer.js';

const MAX_DIFF = 60_000;

/**
 * One reviewer session on a committed refactor. A reviewer that never
 * gives a verdict rejects: the reviewer can only veto (ADR 0001).
 */
export async function review(
  ctx: RoleContext,
  input: {
    opportunity: Opportunity;
    worktree: string;
    baseSha: string;
    refactorId: string;
    verdict: GateVerdict;
    /** The proof so far, as markdown. */
    proof: string;
  },
): Promise<Review> {
  let decision: Review | undefined;
  const decide = (approve: boolean) =>
    tool(
      approve ? 'approve' : 'reject',
      approve ? 'Approve the change. It ends the review.' : 'Reject the change. It ends the review.',
      {
        reasons: { type: 'string', description: 'Why, for the pull request and the team.' },
        rules: {
          type: 'string',
          description:
            "Each of the repo's own rules that applies to this change (name the file), and how the change respects or breaks it.",
        },
      },
      ['reasons', 'rules'],
      async (raw) => {
        const made: Review = { approve, reasons: str(raw, 'reasons'), rules: str(raw, 'rules') };
        decision = made;
        return { text: made.reasons, done: true, summary: approve ? 'Approved.' : 'Rejected.' };
      },
    );
  const tools = [
    tool('get_change', 'The opportunity, the diff, the check results and the proof so far.', {}, [], async () => {
      const diff = await git(input.worktree, ['diff', '-M', input.baseSha, 'HEAD']);
      const cut = diff.length > MAX_DIFF ? `${diff.slice(0, MAX_DIFF)}\n... cut (${diff.length} chars)` : diff;
      return {
        text: `${opportunityMarkdown(input.opportunity)}\n\n# Diff\n\n\`\`\`diff\n${cut}\n\`\`\`\n\n# Gate\n\n${verdictMarkdown(input.verdict)}\n\n# Proof\n\n${input.proof}`,
      };
    }),
    ...repoTools(input.worktree),
    decide(true),
    decide(false),
  ];
  const outcome = await runRole({
    role: 'reviewer',
    runtime: ctx.runtimeFor(resolveRuntime(ctx.loaded.config, 'reviewer')),
    system: await systemPrompt(ctx, REVIEWER, input.opportunity.files),
    prompt: `Review the refactor for "${input.opportunity.title}".`,
    tools,
    limits: ctx.loaded.config.agents.reviewer,
    subject: `refactor:${input.refactorId}`,
    workdir: input.worktree,
    store: ctx.store,
    log: ctx.log,
  });
  return (
    decision ?? {
      approve: false,
      reasons: `The reviewer gave no verdict (${outcome.error ?? outcome.stop}).`,
      rules: '',
    }
  );
}
