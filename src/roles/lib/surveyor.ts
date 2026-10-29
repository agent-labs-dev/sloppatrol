import { finishTool, type RoleOutcome, repoTools, runRole, str, strList, tool } from '../../agents/index.js';
import { type Census, censusMarkdown } from '../../census/index.js';
import { type LoadedConfig, resolveRuntime } from '../../config/index.js';
import {
  fingerprintOf,
  isMetricId,
  isOpportunityKind,
  METRIC_IDS,
  type MetricId,
  newId,
  OPPORTUNITY_KINDS,
  type Opportunity,
  type OpportunityKind,
  type Scorecard,
  type Strength,
  sideOf,
} from '../../domain/index.js';
import { listFiles } from '../../git/index.js';
import { matchesAny } from '../../globs/index.js';
import { metricsFor, rubricMarkdown } from '../../metrics/index.js';
import { type RoleContext, systemPrompt } from './context.js';
import { SURVEYOR } from './prompts.js';
import { scorecardMarkdown } from './scorecard-text.js';

const STRENGTHS: Strength[] = ['strong', 'worth-exploring', 'speculative'];

export type SurveyResult = RoleOutcome & { recorded: Opportunity[] };

type Proposal = Pick<Opportunity, 'kind' | 'files' | 'metrics' | 'strength'>;

/** Reads the parts of a recorded opportunity that the gate depends on, and rejects what it could never keep. */
function readProposal(raw: Record<string, unknown>, config: LoadedConfig['config'], tracked: Set<string>): Proposal {
  const kind = str(raw, 'kind');
  if (!isOpportunityKind(kind)) throw new Error(`kind must be one of ${Object.keys(OPPORTUNITY_KINDS).join(', ')}`);
  const strength = str(raw, 'strength') as Strength;
  if (!STRENGTHS.includes(strength)) throw new Error(`strength must be one of ${STRENGTHS.join(', ')}`);
  const side = sideOf(kind);
  const files = strList(raw, 'files');
  for (const file of files) {
    if (!tracked.has(file))
      throw new Error(
        `${file} is not a tracked file at this commit. List existing files only: the refactor may add new files on its side.`,
      );
    if (matchesAny(file, config.ignore)) throw new Error(`${file} is ignored: no agent may change it.`);
    if (matchesAny(file, config.uncheckedTests))
      throw new Error(`${file}: no check runs it, so no refactor may change it.`);
    if (matchesAny(file, config.tests) !== (side === 'tests'))
      throw new Error(`${file}: a ${kind} opportunity changes ${side} files only.`);
  }
  if (files.length > config.guards.maxFiles)
    throw new Error(`At most ${config.guards.maxFiles} files per opportunity.`);
  const metrics = strList(raw, 'metrics');
  const applicable = new Set<string>(metricsFor(side === 'tests').map((m) => m.id));
  for (const metric of metrics)
    if (!isMetricId(metric) || !applicable.has(metric))
      throw new Error(`${metric}: a ${side} refactor can target ${[...applicable].join(', ')}.`);
  if (metrics.length > 2) throw new Error('Target one or two metrics: the ones this refactor clearly improves.');
  return { kind: kind as OpportunityKind, files, metrics: metrics as MetricId[], strength };
}

/** Reads the code at `sha` in the checkout `dir` and records opportunities. */
export async function survey(
  ctx: RoleContext,
  input: { dir: string; sha: string; census: Census; scorecard?: Scorecard },
): Promise<SurveyResult> {
  const { config } = ctx.loaded;
  const settings = config.agents.surveyor;
  const tracked = new Set(await listFiles(input.dir));
  const recorded: Opportunity[] = [];

  const record = async (raw: Record<string, unknown>): Promise<string> => {
    const proposal = readProposal(raw, config, tracked);
    const fingerprint = fingerprintOf(proposal.kind, proposal.files);
    const existing = (await ctx.store.listOpportunities()).find((o) => o.fingerprint === fingerprint);
    if (existing) throw new Error(`Recorded before (${existing.status}): ${existing.title}`);
    if (recorded.length >= settings.maxPerSurvey) throw new Error('This survey has recorded enough. Call finish.');
    const now = new Date().toISOString();
    const opportunity: Opportunity = {
      ...proposal,
      id: newId(),
      fingerprint,
      side: sideOf(proposal.kind),
      title: str(raw, 'title'),
      problem: str(raw, 'problem'),
      change: str(raw, 'change'),
      benefits: str(raw, 'benefits'),
      status: 'open',
      attempts: 0,
      foundAt: input.sha,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.store.saveOpportunity(opportunity);
    recorded.push(opportunity);
    return `Recorded ${opportunity.id}: ${opportunity.title}`;
  };

  const tools = [
    tool('get_census', 'Facts about the repo, measured by code.', {}, [], async () => ({
      text: censusMarkdown(input.census),
    })),
    tool(
      'get_scorecard',
      "The repo's quality scores per metric, and the files that score worst.",
      {},
      [],
      async () => ({
        text: input.scorecard ? scorecardMarkdown(input.scorecard) : 'No scorecard yet: metrics are off.',
      }),
    ),
    tool('list_opportunities', 'Every opportunity recorded before, with its status.', {}, [], async () => {
      const all = await ctx.store.listOpportunities();
      const text = all.map((o) => `- [${o.status}] ${o.kind}: ${o.title} (${o.files.join(', ')})`).join('\n');
      return { text: text || 'None yet.' };
    }),
    tool(
      'record_opportunity',
      'Record one refactor opportunity.',
      {
        kind: { type: 'string', description: 'What the refactor does.', enum: Object.keys(OPPORTUNITY_KINDS) },
        title: { type: 'string', description: 'A pull request title, under 70 characters.' },
        files: {
          type: 'array',
          items: { type: 'string' },
          description:
            'The existing files the refactor changes, by exact path. Do not list new files: the refactor may add them on its side.',
        },
        problem: { type: 'string', description: 'Why the current shape causes friction.' },
        change: { type: 'string', description: 'The change, in plain words.' },
        benefits: { type: 'string', description: 'What gets better: locality, leverage, testability.' },
        metrics: {
          type: 'array',
          items: { type: 'string', enum: [...METRIC_IDS] },
          description: 'The one or two metrics this refactor clearly improves. The gate checks it.',
        },
        strength: { type: 'string', description: 'How sure you are.', enum: STRENGTHS },
      },
      ['kind', 'title', 'files', 'problem', 'change', 'benefits', 'metrics', 'strength'],
      async (raw) => ({ text: await record(raw) }),
    ),
    ...repoTools(input.dir),
    finishTool('Finish the survey with a summary of what you found.'),
  ];
  const outcome = await runRole({
    role: 'surveyor',
    runtime: ctx.runtimeFor(resolveRuntime(config, 'surveyor')),
    system: `${await systemPrompt(ctx, SURVEYOR, [])}\n\n---\n\n# The metrics rubric\n\n${rubricMarkdown()}`,
    prompt: `Survey the code at ${input.sha.slice(0, 10)}. Record at most ${settings.maxPerSurvey} opportunities.${
      config.focus.length ? ` Look only at: ${config.focus.join(', ')}.` : ''
    }`,
    tools,
    limits: settings,
    subject: `survey:${input.sha}`,
    workdir: input.dir,
    store: ctx.store,
    log: ctx.log,
  });
  return { ...outcome, recorded };
}
