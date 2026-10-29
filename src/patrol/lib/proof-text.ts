import type { MetricId, Proof } from '../../domain/index.js';
import { METRICS, toPercent } from '../../metrics/index.js';

function arrow(before: number | undefined, after: number | undefined): string {
  const pct = (v: number | undefined) => (v === undefined ? '–' : String(toPercent(v)));
  if (before === undefined || after === undefined) return `${pct(before)} → ${pct(after)}`;
  const d = toPercent(after) - toPercent(before);
  return `${pct(before)} → ${pct(after)} (${d > 0 ? '+' : ''}${d})`;
}

/** The proof as markdown: for the reviewer, the pull request and the CLI. */
export function proofMarkdown(proof: Proof): string {
  const b = proof.behaviour;
  const lines = ['### It breaks nothing'];
  lines.push(
    b.side === 'source'
      ? '- **Source only.** No test changed, so the existing tests are the oracle.'
      : '- **Tests only.** No source changed, so the unchanged source proves the new tests right.',
  );
  lines.push(`- **Guards passed:** ${b.guards.join(', ')}.`);
  const counts =
    b.testsHead !== undefined ? ` ${b.testsBase ?? '?'} tests passed on main, ${b.testsHead} on this change.` : '';
  lines.push(`- **The same checks** pass on main and on this change.${counts}`);
  if (b.mutation)
    lines.push(
      `- **The tests can fail.** Planted bug in \`${b.mutation.file}\`: \`${b.mutation.find.trim().slice(0, 80)}\` → \`${b.mutation.replace.trim().slice(0, 80)}\`. ${b.mutation.caught ? 'A test check turned red.' : 'No test check caught it.'}${b.mutation.caughtBefore === false ? ' The old tests on main missed it: this is new coverage.' : ''} (${b.mutation.why})`,
    );
  const imp = proof.improvement;
  if (imp) {
    lines.push(
      '',
      '### It makes the code better',
      '',
      `Scored blind against the rubric (\`${imp.rubric}\`) by ${imp.judges} independent assessor${imp.judges === 1 ? '' : 's'}, 0 worst to 100 best, mean over the changed files:`,
      '',
    );
    lines.push('| Metric | Before → after |', '| --- | --- |');
    for (const metric of METRICS) {
      if (imp.before[metric.id] === undefined && imp.after[metric.id] === undefined) continue;
      const target = imp.targets.includes(metric.id as MetricId) ? ' (target)' : '';
      lines.push(`| ${metric.name}${target} | ${arrow(imp.before[metric.id], imp.after[metric.id])} |`);
    }
    const s = imp.signals;
    lines.push(
      '',
      `Measured: ${s.before.lines} → ${s.after.lines} lines, nesting ${s.before.maxNesting} → ${s.after.maxNesting}, comment lines ${s.before.commentLines} → ${s.after.commentLines}, mocks ${s.before.mocks} → ${s.after.mocks}, suppressions ${s.before.suppressions} → ${s.after.suppressions}.`,
    );
    lines.push('', `**${imp.improved ? 'Improved' : 'Not improved'}:** ${imp.reason}`);
  }
  if (proof.rules) {
    lines.push(
      '',
      "### It follows the repo's rules",
      '',
      `Read: ${proof.rules.sources.map((s) => `\`${s}\``).join(', ') || 'none found'}.`,
      '',
      proof.rules.compliance,
    );
  }
  return lines.join('\n');
}
