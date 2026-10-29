import { finishTool, runRole, str, tool } from '../../agents/index.js';
import { resolveRuntime } from '../../config/index.js';
import { isMetricId, type MetricId, type MetricScore } from '../../domain/index.js';
import { measure, metricsFor, rubricMarkdown } from '../../metrics/index.js';
import { type RoleContext, systemPrompt } from './context.js';
import { ASSESSOR } from './prompts.js';

/** One file to judge. `label` is all the assessor knows it by. */
export type AssessUnit = { label: string; path: string; text: string; isTest: boolean };
export type AssessedScores = Map<string, Partial<Record<MetricId, MetricScore>>>;

const PAGE = 400;

/**
 * One assessor session over a set of files. It scores each against the
 * rubric and cites the lines behind each score. In a blind session, two
 * versions of one file arrive under neutral labels in random order.
 */
export async function assess(
  ctx: RoleContext,
  input: { units: AssessUnit[]; subject: string; workdir: string; blind: boolean },
): Promise<AssessedScores> {
  const scored: AssessedScores = new Map();
  const unit = (label: string) => {
    const found = input.units.find((u) => u.label === label);
    if (!found) throw new Error(`No unit ${label}. Call list_units.`);
    return found;
  };
  const tools = [
    tool('list_units', 'The files to score, and which metrics apply to each.', {}, [], async () => ({
      text: input.units
        .map(
          (u) =>
            `- ${u.label}: \`${u.path}\`, ${u.text.split('\n').length} lines; score ${metricsFor(u.isTest)
              .map((m) => m.id)
              .join(', ')}${scored.has(u.label) ? ' (scored)' : ''}`,
        )
        .join('\n'),
    })),
    tool(
      'get_unit',
      `One file with line numbers, ${PAGE} lines at a time, and the facts code measured in it.`,
      {
        label: { type: 'string', description: 'The unit label from list_units.' },
        start: { type: 'number', description: 'First line, 1-based. Default 1.' },
      },
      ['label'],
      async (raw) => {
        const u = unit(str(raw, 'label'));
        const lines = u.text.split('\n');
        const start = Math.max(1, Number(raw.start ?? 1));
        const body = lines
          .slice(start - 1, start - 1 + PAGE)
          .map((line, i) => `${start + i}\t${line}`)
          .join('\n');
        const more = start - 1 + PAGE < lines.length ? `\n(more: call again with start ${start + PAGE})` : '';
        return { text: `# ${u.label} (\`${u.path}\`)\nMeasured: ${JSON.stringify(measure(u.text))}\n\n${body}${more}` };
      },
    ),
    tool(
      'score_unit',
      'Record the scores of one unit: every metric that applies, 0 to 4, each with the lines that justify it.',
      {
        label: { type: 'string', description: 'The unit label.' },
        scores: {
          type: 'object',
          description: 'For each metric id: { "score": 0-4, "evidence": "line numbers and why" }.',
        },
      },
      ['label', 'scores'],
      async (raw) => {
        const u = unit(str(raw, 'label'));
        const given = (raw.scores ?? {}) as Record<string, { score?: unknown; evidence?: unknown }>;
        const scores: Partial<Record<MetricId, MetricScore>> = {};
        for (const metric of metricsFor(u.isTest)) {
          const entry = given[metric.id];
          const score = Number(entry?.score);
          if (!Number.isInteger(score) || score < 0 || score > 4)
            throw new Error(`${metric.id}: score must be a whole number 0-4.`);
          if (typeof entry?.evidence !== 'string' || !entry.evidence.trim())
            throw new Error(`${metric.id}: cite the lines as evidence.`);
          scores[metric.id] = { score, evidence: entry.evidence.trim() };
        }
        const extra = Object.keys(given).filter((id) => !isMetricId(id) || !scores[id]);
        if (extra.length) throw new Error(`These metrics do not apply to ${u.label}: ${extra.join(', ')}.`);
        scored.set(u.label, scores);
        const left = input.units.filter((x) => !scored.has(x.label)).length;
        return { text: left ? `Recorded. ${left} unit(s) left.` : 'Recorded. Every unit is scored: call finish.' };
      },
    ),
    finishTool('Finish when every unit is scored.'),
  ];
  const settings = ctx.loaded.config.agents.assessor;
  const blind = input.blind
    ? '\n\nSome units are two versions of the same file. You do not know which one is newer, and it does not matter: score each on its own against the rubric.'
    : '';
  await runRole({
    role: 'assessor',
    runtime: ctx.runtimeFor(resolveRuntime(ctx.loaded.config, 'assessor')),
    system: `${await systemPrompt(
      ctx,
      ASSESSOR,
      input.units.map((u) => u.path),
    )}\n\n---\n\n# The rubric\n\n${rubricMarkdown()}`,
    prompt: `Score ${input.units.length} unit(s) against the rubric.${blind}`,
    tools,
    limits: settings,
    subject: input.subject,
    workdir: input.workdir,
    store: ctx.store,
    log: ctx.log,
  });
  return scored;
}
