import { createHash } from 'node:crypto';
import type { MetricId, UnitScores } from '../domain/index.js';
import { METRICS, type Metric } from './lib/rubric.js';

export { measure, sumSignals } from './lib/signals.js';
export { METRICS };

/** Names the rubric text: scores under another version are never compared. */
export const RUBRIC_VERSION = createHash('sha256').update(JSON.stringify(METRICS)).digest('hex').slice(0, 10);

export function metricsFor(isTest: boolean): Metric[] {
  return METRICS.filter((m) => m.appliesTo === 'all' || m.appliesTo === (isTest ? 'tests' : 'source'));
}

export function contentHash(path: string, text: string): string {
  return createHash('sha256').update(`${path}\0${text}\0${RUBRIC_VERSION}`).digest('hex').slice(0, 20);
}

/**
 * A score as people read it: 0-100. The assessor still picks one of the
 * five anchored levels (0-4), which keeps judges consistent; a level of 3
 * shows as 75, and a mean of judges or files can land between levels.
 */
export function toPercent(score: number): number {
  return Math.round((score / 4) * 100);
}

/** One number for a scorecard: the mean of its metric means, 0-100. */
export function overallPercent(means: Partial<Record<MetricId, number>>): number | undefined {
  const values = Object.values(means);
  return values.length ? toPercent(values.reduce((a, b) => a + b, 0) / values.length) : undefined;
}

/**
 * The mean score per metric over the files where it applies, weighted by
 * lines: a 3,000-line file weighs as much as sixty 50-line files.
 */
export function meanScores(units: UnitScores[]): Partial<Record<MetricId, number>> {
  const means: Partial<Record<MetricId, number>> = {};
  for (const metric of METRICS) {
    let total = 0;
    let weight = 0;
    for (const unit of units) {
      const score = unit.scores[metric.id];
      if (!score) continue;
      const lines = Math.max(1, unit.signals.lines);
      total += score.score * lines;
      weight += lines;
    }
    if (weight) means[metric.id] = Math.round((total / weight) * 100) / 100;
  }
  return means;
}

/** The rubric as the assessor and the surveyor read it. */
export function rubricMarkdown(): string {
  return METRICS.map(
    (m) =>
      `## ${m.name} (\`${m.id}\`, ${m.appliesTo === 'all' ? 'every file' : `${m.appliesTo} files`})\n\n${m.question}\n\n${m.levels
        .map((level, score) => `- **${score}**: ${level}`)
        .join('\n')}\n\nLook for: ${m.lookFor.join('; ')}.`,
  ).join('\n\n');
}
