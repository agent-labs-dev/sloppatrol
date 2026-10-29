import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { str, tool } from '../../agents/index.js';
import type { CheckRun, Mutation, Opportunity } from '../../domain/index.js';
import { guardRulesFor, inspectChange, runRecordedChecks } from '../../gate/index.js';
import { matchesAny } from '../../globs/index.js';
import type { RoleContext } from './context.js';

/**
 * How long one run_checks call waits. Agent CLIs give up on a tool call
 * after a few minutes (Claude Code after 300 s), so a long run answers
 * "still running" in time and the next call joins it.
 */
const WAIT_MS = 240_000;

/** The promise's value, or undefined when it takes longer than `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((done) => {
    timer = setTimeout(() => done(undefined), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Work = { opportunity: Opportunity; worktree: string; baseSha: string; refactorId: string; branch: string };

/**
 * The refactorer's tools on its own change: the guards, the repo's checks,
 * and for a tests refactor, the mutation its tests must catch.
 */
export function changeTools(ctx: RoleContext, work: Work) {
  const { config } = ctx.loaded;
  const { worktree, baseSha } = work;
  const rules = guardRulesFor(config, work.opportunity.side);
  const target = { purpose: 'refactorer' as const, sha: baseSha, refactorId: work.refactorId, branch: work.branch };
  let checks: Promise<CheckRun> | undefined;
  let mutation: Mutation | undefined;

  const guardsTool = tool(
    'check_guards',
    'Apply the guards to your change so far. Every finding rejects the refactor.',
    {},
    [],
    async () => {
      const { findings, stat } = await inspectChange(worktree, baseSha, rules);
      const head = `${stat.files} files, +${stat.added} -${stat.removed} lines.`;
      const list = findings.map((f) => `- ${f.guard}${f.file ? ` ${f.file}` : ''}: ${f.detail}`).join('\n');
      return { text: findings.length ? `${head}\n${list}` : `${head} No finding.` };
    },
  );

  const checksTool = tool(
    'run_checks',
    "Run the repo's own checks in your worktree. When they take long, it answers that they still run: call it again to wait for the same run.",
    {},
    [],
    async () => {
      checks ??= runRecordedChecks(ctx.store, target, config.checks, worktree, ctx.log);
      const run = await within(checks, WAIT_MS);
      if (!run) return { text: 'The checks still run. Call run_checks again to wait for the result.' };
      checks = undefined;
      const text = run.results
        .map((r) => `## ${r.name}: ${r.ok ? 'passed' : 'FAILED'}\n${r.ok ? '' : r.output}`)
        .join('\n');
      const passed = run.status === 'passed';
      return {
        text: passed ? `${text}\nEvery check passed.` : text,
        summary: passed ? 'Checks passed.' : 'A check failed.',
      };
    },
  );

  const mutationTool = tool(
    'set_mutation',
    'Name one small edit to a source file that your tests must catch: the gate applies it and requires a red test run. Pick a real bug the tests pin, e.g. `>` to `>=` on a boundary.',
    {
      file: { type: 'string', description: 'The source file, relative to the repository root.' },
      find: { type: 'string', description: 'The exact text to replace. It must occur once in the file.' },
      replace: { type: 'string', description: 'The bug.' },
      why: { type: 'string', description: 'Which test catches it, and why.' },
    },
    ['file', 'find', 'replace', 'why'],
    async (raw) => {
      const file = str(raw, 'file');
      if (matchesAny(file, config.tests)) throw new Error('The mutation must change a source file, not a test.');
      const text = await readFile(join(worktree, file), 'utf8');
      const find = str(raw, 'find');
      if (text.split(find).length !== 2) throw new Error('find must occur exactly once in the file.');
      mutation = { file, find, replace: String(raw.replace ?? ''), why: str(raw, 'why') };
      return { text: 'Recorded. The gate will apply it after your change and expect a red test run.' };
    },
  );

  return {
    tools: [guardsTool, checksTool, ...(work.opportunity.side === 'tests' ? [mutationTool] : [])],
    mutation: () => mutation,
    /** A run the agent stopped waiting for still uses the worktree: wait for it. */
    settle: async () => {
      await checks;
    },
  };
}
