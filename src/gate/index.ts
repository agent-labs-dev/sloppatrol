import type { SloppatrolConfig } from '../config/index.js';
import type { GateVerdict, GuardFinding, Side } from '../domain/index.js';
import { runCommand } from './lib/checks.js';
import { readDiff } from './lib/diff.js';
import { checkGuards, diffStat, type GuardRules } from './lib/guards.js';

export { checksKey, runRecordedChecks } from './lib/recorded.js';
export { testsPassed } from './lib/test-count.js';
export type { GuardRules };

export type Inspection = {
  findings: GuardFinding[];
  stat: { files: number; added: number; removed: number };
  /** The changed paths, after renames. */
  files: string[];
};

/** Reads the worktree's change since `baseSha` and applies every guard to it. */
export async function inspectChange(worktree: string, baseSha: string, rules: GuardRules): Promise<Inspection> {
  const diff = await readDiff(worktree, baseSha);
  return { findings: checkGuards(diff, rules), stat: diffStat(diff), files: diff.map((f) => f.path) };
}

/** The repo's prepare commands, for a fresh checkout or worktree. Throws on the first failure. */
export async function prepare(commands: string[], dir: string, log?: (line: string) => void): Promise<void> {
  for (const [index, run] of commands.entries()) {
    log?.(`prepare: ${run}`);
    const result = await runCommand({ name: `prepare-${index + 1}`, run, timeoutMinutes: 30 }, dir);
    if (!result.ok) throw new Error(`prepare failed: ${run}\n${result.output}`);
  }
}

/** The verdict as markdown, for a pull request or an agent. */
export function verdictMarkdown(verdict: GateVerdict): string {
  const guards = verdict.guards.length
    ? verdict.guards.map((g) => `- ✗ ${g.guard}${g.file ? ` \`${g.file}\`` : ''}: ${g.detail}`).join('\n')
    : '- ✓ one side only, no frozen file, no suppression, no test removed, within the size limit';
  const checks = verdict.checks
    .map((c) => `- ${c.ok ? '✓' : '✗'} \`${c.name}\` (\`${c.command}\`) in ${(c.durationMs / 1000).toFixed(1)}s`)
    .join('\n');
  const review = verdict.review
    ? `### Review: ${verdict.review.approve ? 'approved' : 'rejected'}\n\n${verdict.review.reasons}`
    : '';
  return [`### Guards\n\n${guards}`, checks ? `### Checks\n\n${checks}` : '', review].filter(Boolean).join('\n\n');
}

export function guardRulesFor(config: SloppatrolConfig, side: Side): GuardRules {
  return { side, tests: config.tests, ignore: config.ignore, uncheckedTests: config.uncheckedTests, ...config.guards };
}
