import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoadedConfig } from '../../config/index.js';
import {
  gainOf,
  type Improvement,
  isMetricId,
  type MetricId,
  type MetricScore,
  type Mutation,
  type Opportunity,
  type UnitScores,
} from '../../domain/index.js';
import { runRecordedChecks } from '../../gate/index.js';
import { git, tryGit } from '../../git/index.js';
import { matchesAny } from '../../globs/index.js';
import { contentHash, meanScores, measure, RUBRIC_VERSION, sumSignals, toPercent } from '../../metrics/index.js';
import { type AssessedScores, type AssessUnit, assess, type RoleContext } from '../../roles/index.js';

/**
 * Applies the mutation to the source in `dir`, runs the test checks, and
 * puts the source back. The mutation is caught only when a test check turns red.
 */
export async function mutationProof(
  ctx: RoleContext,
  input: { dir: string; mutation: Mutation; sha: string; refactorId: string; branch: string },
): Promise<{ caught: boolean; runId: string }> {
  const { config } = ctx.loaded;
  const file = join(input.dir, input.mutation.file);
  const original = await readFile(file, 'utf8');
  if (original.split(input.mutation.find).length !== 2)
    throw new Error(`The mutation's text is not once in ${input.mutation.file}.`);
  const testChecks = config.checks.filter((c) => c.tests);
  const checks = testChecks.length ? testChecks : config.checks;
  await writeFile(file, original.replace(input.mutation.find, input.mutation.replace));
  try {
    const run = await runRecordedChecks(
      ctx.store,
      { purpose: 'mutation', sha: input.sha, refactorId: input.refactorId, branch: input.branch },
      checks,
      input.dir,
      ctx.log,
    );
    return { caught: run.status === 'failed', runId: run.id };
  } finally {
    await writeFile(file, original);
  }
}

/** Two labels per file in random order, so the assessor cannot tell the old version from the new. */
function blindUnits(files: { path: string; before?: string; after?: string }[], isTest: (path: string) => boolean) {
  const units: (AssessUnit & { file: string; version: 'before' | 'after' })[] = [];
  for (const f of files)
    for (const version of ['before', 'after'] as const) {
      const text = f[version];
      if (text !== undefined)
        units.push({ label: '', path: f.path, text, isTest: isTest(f.path), file: f.path, version });
    }
  for (let i = units.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [units[i], units[j]] = [units[j]!, units[i]!];
  }
  units.forEach((u, i) => {
    u.label = `unit-${i + 1}`;
  });
  return units;
}

/**
 * Each unit's scores averaged over the judges that scored it. A unit no
 * judge scored stays out, and the proof reports it.
 */
function meanOfJudges(panel: AssessedScores[], labels: string[]): AssessedScores {
  const mean: AssessedScores = new Map();
  for (const label of labels) {
    const all = panel.flatMap((judge) => (judge.has(label) ? [judge.get(label)!] : []));
    if (!all.length) continue;
    const scores: Partial<Record<MetricId, MetricScore>> = {};
    for (const metric of Object.keys(all[0]!) as MetricId[]) {
      const given = all.flatMap((s) => (s[metric] ? [s[metric]!] : []));
      const score = Math.round((given.reduce((sum, s) => sum + s.score, 0) / given.length) * 100) / 100;
      scores[metric] = { score, evidence: given.map((s) => s.evidence).join(' | ') };
    }
    mean.set(label, scores);
  }
  return mean;
}

/**
 * Kept when every target metric went up, or with no targets, when any metric
 * went up; and no metric dropped by more than `tolerance` (judge noise). A
 * refactor whose gain is proven another way (`requireGain: false`) only
 * must not make a metric worse.
 */
function verdictOf(
  targets: MetricId[],
  before: Partial<Record<MetricId, number>>,
  after: Partial<Record<MetricId, number>>,
  options: { tolerance: number; requireGain: boolean },
): { improved: boolean; reason: string } {
  const delta = (m: MetricId) => (after[m] ?? 0) - (before[m] ?? 0);
  const pct = (v: number | undefined) => (v === undefined ? '–' : String(toPercent(v)));
  const show = (m: MetricId) => `${m} ${pct(before[m])} → ${pct(after[m])}`;
  const scored = (Object.keys(after) as MetricId[]).filter((m) => before[m] !== undefined);
  const worse = scored.filter((m) => delta(m) < -options.tolerance);
  if (!options.requireGain)
    return worse.length
      ? { improved: false, reason: `A metric got worse: ${worse.map(show).join(', ')}.` }
      : { improved: true, reason: `No metric got worse: ${scored.map(show).join(', ')}.` };
  const flat = targets.filter((m) => !(delta(m) > 0));
  if (flat.length)
    return { improved: false, reason: `The target metric did not improve: ${flat.map(show).join(', ')}.` };
  if (!targets.length && !scored.some((m) => delta(m) > 0)) return { improved: false, reason: 'No metric improved.' };
  if (worse.length) return { improved: false, reason: `Another metric got worse: ${worse.map(show).join(', ')}.` };
  const better = targets.length ? targets : scored.filter((m) => delta(m) > 0);
  return { improved: true, reason: better.map(show).join(', ') };
}

/**
 * Scores every changed file on the refactor's side twice, before and after,
 * blind and in one session, and decides whether the target metrics improved.
 */
export async function improvementProof(
  ctx: RoleContext,
  input: { worktree: string; baseSha: string; opportunity: Opportunity; changed: string[]; refactorId: string },
): Promise<Improvement> {
  const config: LoadedConfig['config'] = ctx.loaded.config;
  const isTest = (path: string) => matchesAny(path, config.tests);
  const onSide = input.changed.filter((path) => isTest(path) === (input.opportunity.side === 'tests'));
  const files = await Promise.all(
    onSide.map(async (path) => ({
      path,
      before: await tryGit(input.worktree, ['show', `${input.baseSha}:${path}`]),
      after: await readFile(join(input.worktree, path), 'utf8').catch(() => undefined),
    })),
  );
  const units = blindUnits(files, isTest);
  // A panel of independent judges, at once: each score is their mean, so one
  // judge's swing of a level cannot decide the proof alone.
  const panel = await Promise.all(
    Array.from({ length: config.metrics.judges }, () =>
      assess(ctx, { units, subject: `refactor:${input.refactorId}`, workdir: input.worktree, blind: true }),
    ),
  );
  const scored = meanOfJudges(
    panel,
    units.map((u) => u.label),
  );
  const byVersion = (version: 'before' | 'after') =>
    units.flatMap((u): UnitScores[] =>
      u.version === version && scored.has(u.label)
        ? [
            {
              path: u.path,
              contentHash: contentHash(u.path, u.text),
              rubric: RUBRIC_VERSION,
              signals: measure(u.text),
              scores: scored.get(u.label)!,
            },
          ]
        : [],
    );
  const before = byVersion('before');
  const after = byVersion('after');
  const missing = units.filter((u) => !scored.has(u.label)).length;
  // An opportunity recorded under an older rubric can name a metric that no longer exists.
  const targets = (input.opportunity.metrics ?? []).filter(isMetricId);
  const means = { before: meanScores(before), after: meanScores(after) };
  const verdict = missing
    ? { improved: false, reason: `The assessor did not score ${missing} unit(s).` }
    : verdictOf(targets, means.before, means.after, {
        tolerance: config.metrics.tolerance,
        requireGain: gainOf(input.opportunity.kind) === 'metrics',
      });
  return {
    rubric: RUBRIC_VERSION,
    judges: config.metrics.judges,
    targets,
    ...means,
    units: files.map((f) => ({
      path: f.path,
      before: before.find((u) => u.path === f.path),
      after: after.find((u) => u.path === f.path),
    })),
    signals: { before: sumSignals(before.map((u) => u.signals)), after: sumSignals(after.map((u) => u.signals)) },
    ...verdict,
  };
}

/** The changed paths of the refactor's commit. */
export async function changedFiles(worktree: string, baseSha: string): Promise<string[]> {
  return (await git(worktree, ['diff', '--name-only', '-M', baseSha, 'HEAD'])).split('\n').filter(Boolean);
}
