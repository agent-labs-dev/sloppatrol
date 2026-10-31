import type { Scorecard } from '../../domain/index.js';
import { METRICS, overallPercent, toPercent } from '../../metrics/index.js';

const share = (part: number, whole: number) => `${whole ? Math.round((part / whole) * 100) : 0}%`;

/** The scorecard for an agent: the mean per metric, and the worst files for each. */
export function scorecardMarkdown(scorecard: Scorecard): string {
  const overall = overallPercent(scorecard.means);
  const c = scorecard.coverage;
  const lines = [
    `# Scorecard at ${scorecard.sha.slice(0, 10)}: ${overall ?? '–'}% overall`,
    c
      ? `Covers ${c.files} of ${c.totalFiles} files, ${share(c.lines, c.totalLines)} of the lines. Each cycle scores more; \`sloppatrol score\` scores the rest now.`
      : '',
  ];
  for (const metric of METRICS) {
    const mean = scorecard.means[metric.id];
    if (mean === undefined) continue;
    const worst = scorecard.units
      .filter((u) => u.scores[metric.id])
      .sort((a, b) => a.scores[metric.id]!.score - b.scores[metric.id]!.score)
      .slice(0, 3)
      .map(
        (u) =>
          `  - \`${u.path}\`: ${toPercent(u.scores[metric.id]!.score)}% (${u.scores[metric.id]!.evidence.slice(0, 200)})`,
      );
    lines.push(`## ${metric.name} (\`${metric.id}\`): ${toPercent(mean)}%\n${worst.join('\n')}`);
  }
  const missing = (scorecard.guardrails ?? []).filter((g) => !g.present);
  if (missing.length)
    lines.push(
      `## Missing repo guardrails (a person must add these; config files are frozen)\n${missing.map((g) => `  - ${g.name}: ${g.evidence}`).join('\n')}`,
    );
  return lines.join('\n\n');
}
