import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Census } from '../../census/index.js';
import type { Scorecard, UnitScores } from '../../domain/index.js';
import { matchesAny } from '../../globs/index.js';
import { contentHash, meanScores, measure, RUBRIC_VERSION } from '../../metrics/index.js';
import { type AssessedScores, type AssessUnit, assess, type RoleContext } from '../../roles/index.js';
import { inPool } from './pool.js';

/** About this many lines per assessor session: a large file gets a session of its own. */
const BATCH_LINES = 2500;
/** Tool calls a session needs besides the two per file (`get_unit`, `score_unit`): `list_units`, `finish`, and room to spare. */
const SESSION_CALLS = 6;

type File = { path: string; text: string; hash: string; isTest: boolean };

/**
 * The order in which unscored files get their first score: the most changed
 * first (where refactors pay off), then the largest (where most of the code
 * is), then everything else by size. A quarter of each run goes to test
 * files, so test quality is scored from the first run.
 */
function nextToScore(unscored: File[], census: Census, budget: number): File[] {
  const rank = new Map<string, number>();
  for (const path of [...census.churn.map((c) => c.path), ...census.largest.map((f) => f.path)])
    if (!rank.has(path)) rank.set(path, rank.size);
  const ordered = [...unscored].sort(
    (a, b) =>
      (rank.get(a.path) ?? Number.POSITIVE_INFINITY) - (rank.get(b.path) ?? Number.POSITIVE_INFINITY) ||
      b.text.length - a.text.length,
  );
  const tests = ordered.filter((f) => f.isTest).slice(0, Math.ceil(budget / 4));
  const sources = ordered.filter((f) => !f.isTest).slice(0, budget - tests.length);
  const picked = [...sources, ...tests];
  // Fewer sources than room: fill with more tests.
  return [...picked, ...ordered.filter((f) => f.isTest && !picked.includes(f)).slice(0, budget - picked.length)];
}

/**
 * Groups files into batches of about `BATCH_LINES` lines, one file at least,
 * and at most `maxUnits` files: many small files would use up the step
 * budget of a session before it scored them all.
 */
function batches<T extends { text: string }>(units: T[], maxUnits: number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let lines = 0;
  for (const unit of units) {
    const size = unit.text.split('\n').length;
    if (current.length && (lines + size > BATCH_LINES || current.length >= maxUnits)) {
      groups.push(current);
      current = [];
      lines = 0;
    }
    current.push(unit);
    lines += size;
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Scores the units in batches, `metrics.parallel` sessions at a time, so no session has to hold them all. */
async function assessInBatches(
  ctx: RoleContext,
  units: AssessUnit[],
  input: { dir: string; subject: string },
): Promise<AssessedScores> {
  const { config } = ctx.loaded;
  const maxUnits = Math.max(1, Math.floor((config.agents.assessor.maxSteps - SESSION_CALLS) / 2));
  const sessions = batches(units, maxUnits).map(
    (batch) => () => assess(ctx, { units: batch, subject: input.subject, workdir: input.dir, blind: false }),
  );
  const all: AssessedScores = new Map();
  for (const scored of await inPool(config.metrics.parallel, sessions))
    for (const [label, scores] of scored) all.set(label, scores);
  return all;
}

/**
 * The scores of `paths` in the checkout `dir` of `sha`. Every file whose
 * content and rubric were scored before keeps its scores; up to `budget`
 * unscored files get their first score now. Returns the scored files and
 * every file that was read.
 */
export async function scoreFiles(
  ctx: RoleContext,
  input: { dir: string; sha: string; paths: readonly string[]; census: Census; budget?: number },
): Promise<{ scored: UnitScores[]; files: File[] }> {
  const { config } = ctx.loaded;
  const budget = input.budget ?? config.metrics.panel;
  const files: File[] = [];
  for (const path of input.paths) {
    const text = await readFile(join(input.dir, path), 'utf8').catch(() => undefined);
    if (text !== undefined)
      files.push({ path, text, hash: contentHash(path, text), isTest: matchesAny(path, config.tests) });
  }
  const scored: UnitScores[] = [];
  const unscored: File[] = [];
  for (const file of files) {
    const cached = await ctx.store.getUnitScores(file.hash);
    if (cached) scored.push(cached);
    else unscored.push(file);
  }
  const fresh = nextToScore(unscored, input.census, budget);
  if (fresh.length) {
    ctx.log(`scoring ${fresh.length} of ${files.length} files at ${input.sha.slice(0, 10)}`);
    await ctx.store.setStatus({
      role: 'assessor',
      state: 'running',
      detail: `Scoring ${fresh.length} more file(s) of ${input.sha.slice(0, 10)}`,
    });
    const units = fresh.map((f) => ({ label: f.path, path: f.path, text: f.text, isTest: f.isTest }));
    const results = await assessInBatches(ctx, units, { dir: input.dir, subject: `score:${input.sha}` });
    for (const file of fresh) {
      const scores = results.get(file.path);
      if (!scores) continue;
      const unit: UnitScores = {
        path: file.path,
        contentHash: file.hash,
        rubric: RUBRIC_VERSION,
        signals: measure(file.text),
        scores,
      };
      await ctx.store.saveUnitScores(unit);
      scored.push(unit);
    }
  }
  return { scored, files };
}

/**
 * The scorecard of `sha`: the scores of every file in the census. So the
 * scorecard covers more of the repo each cycle, a file is judged once per
 * content, and the trend moves only where code changed.
 */
export async function scorecardFor(
  ctx: RoleContext,
  input: { dir: string; sha: string; census: Census; budget?: number },
): Promise<Scorecard> {
  const { scored, files } = await scoreFiles(ctx, { ...input, paths: input.census.files });
  const lines = (f: { text: string }) => f.text.split('\n').length;
  const scorecard: Scorecard = {
    sha: input.sha,
    at: new Date().toISOString(),
    rubric: RUBRIC_VERSION,
    units: scored,
    means: meanScores(scored),
    coverage: {
      files: scored.length,
      totalFiles: files.length,
      lines: scored.reduce((sum, u) => sum + u.signals.lines, 0),
      totalLines: files.reduce((sum, f) => sum + lines(f), 0),
    },
    guardrails: input.census.guardrails,
  };
  await ctx.store.saveScorecard(scorecard);
  return scorecard;
}
