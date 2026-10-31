import {
  type AgentStatus,
  type CheckRun,
  type Cycle,
  type MetricId,
  type Opportunity,
  pickOpportunities,
  type Refactor,
  type Scorecard,
  type Strength,
} from '../../domain/index.js';
import { METRICS, meanScores, overallPercent, toPercent } from '../../metrics/index.js';

export type Tone = 'pass' | 'warn' | 'fail' | 'info' | 'run';

/** A status as the patrol wrote it, and whether its process still runs. */
export type LiveStatus = AgentStatus & { alive: boolean; stale: boolean };

/** One step of a refactor's pipeline: done, failed, running, waiting for a person, or not reached. */
type Step = { id: StepId; label: string; state: 'ok' | 'bad' | 'run' | 'wait' | '' };
type StepId = 'refactorer' | 'guards' | 'checks' | 'mutation' | 'metrics' | 'review' | 'pr';

/**
 * What became of a refactor, for people: it waits for a person (`waits`),
 * the gate rejected it, it stopped with an error, or Sloppatrol stopped
 * while it ran (`interrupted`).
 */
export type Outcome = 'working' | 'waits' | 'rejected' | 'error' | 'interrupted' | 'merged' | 'closed';

export type RefactorRow = Refactor & {
  title: string;
  kind?: Opportunity['kind'];
  side?: Opportunity['side'];
  outcome: Outcome;
  /** The step that rejected it. */
  rejectedAt?: StepId;
  steps: Step[];
};

export type CheckRunRow = CheckRun & {
  outcome: { tone: 'ok' | 'bad' | 'run' | 'stop'; text: string };
  /**
   * A result that needs a person: red checks on main, a refactor that the
   * gate failed, or a planted bug the tests missed. A red refactorer try is
   * not one: the refactorer runs the checks to test its own change.
   */
  problem: boolean;
};

export type SessionRow = {
  id: string;
  role: string;
  subject?: string;
  startedAt: string;
  endedAt?: string;
  /** `stopped`: it has no end, and no Sloppatrol process runs. */
  state: 'running' | 'done' | 'failed' | 'stopped';
  last: string;
  costUsd: number;
};

type AttentionItem = {
  tone: Tone;
  title: string;
  detail: string;
  command?: string;
  /** A page of the dashboard, with a filter or a selected item. */
  target?: { tab: string; filter?: string; select?: string };
  links?: { label: string; href: string; select?: string }[];
};

export type ProjectSummary = ReturnType<typeof projectSummary>;

const STEP_LABELS: Record<StepId, string> = {
  refactorer: 'Refactorer',
  guards: 'Guards',
  checks: 'Checks',
  mutation: 'Mutation',
  metrics: 'Metrics',
  review: 'Review',
  pr: 'Pull request',
};
const DAY = 24 * 3_600_000;

/**
 * The pipeline of one refactor, from its own record and its check runs.
 * The verdict and the proof hold the result of each step, so an old refactor
 * shows the right steps also when its check runs are no longer on the page.
 */
export function refactorRow(
  refactor: Refactor,
  opportunity: Opportunity | undefined,
  runs: CheckRun[],
  active: boolean,
): RefactorRow {
  const { verdict, proof } = refactor;
  const interrupted =
    (refactor.status === 'working' && !active) ||
    (refactor.status === 'failed' && /^Interrupted/.test(refactor.reason ?? ''));
  const working = refactor.status === 'working' && !interrupted;
  const mine = runs.filter((r) => r.refactorId === refactor.id);
  const gate =
    (verdict?.checkRunId && runs.find((r) => r.id === verdict.checkRunId)) ||
    mine.findLast((r) => r.purpose === 'gate');
  const tests = opportunity?.side === 'tests';
  const mutationRun = mine.findLast((r) => r.purpose === 'mutation');
  const mutation = proof?.behaviour.mutation;

  const states: Partial<Record<StepId, Step['state']>> = {};
  states.refactorer = refactor.headSha ? 'ok' : working ? 'run' : 'bad';
  states.guards = verdict ? (verdict.guards.length ? 'bad' : 'ok') : gate ? 'ok' : '';
  states.checks = gate
    ? gate.status === 'running'
      ? working
        ? 'run'
        : ''
      : gate.status === 'passed'
        ? 'ok'
        : 'bad'
    : verdict?.checks.some((c) => !c.ok)
      ? 'bad'
      : '';
  if (tests)
    states.mutation = mutation
      ? mutation.caught && !mutation.caughtBefore
        ? 'ok'
        : 'bad'
      : working && mutationRun?.status === 'running'
        ? 'run'
        : '';
  const ready = states.checks === 'ok' && (!tests || states.mutation === 'ok');
  states.metrics = proof?.improvement ? (proof.improvement.improved ? 'ok' : 'bad') : working && ready ? 'run' : '';
  states.review = verdict?.review
    ? verdict.review.approve
      ? 'ok'
      : 'bad'
    : working && states.metrics === 'ok'
      ? 'run'
      : '';
  states.pr = refactor.prUrl
    ? refactor.status === 'closed'
      ? 'bad'
      : 'ok'
    : refactor.status === 'verified'
      ? 'wait'
      : '';
  const order: StepId[] = [
    'refactorer',
    'guards',
    'checks',
    ...(tests ? (['mutation'] as const) : []),
    'metrics',
    'review',
    'pr',
  ];
  const steps = order.map((id) => ({
    id,
    label: id === 'pr' && refactor.status === 'merged' ? 'Merged' : STEP_LABELS[id],
    state: states[id] ?? '',
  }));
  const outcome: Outcome = interrupted
    ? 'interrupted'
    : working
      ? 'working'
      : refactor.status === 'verified' || refactor.status === 'published'
        ? 'waits'
        : refactor.status === 'failed'
          ? 'error'
          : refactor.status;
  const rejectedAt =
    refactor.status === 'rejected' ? (steps.find((s) => s.state === 'bad')?.id ?? 'refactorer') : undefined;
  return {
    ...refactor,
    title: opportunity?.title ?? refactor.branch,
    ...(opportunity ? { kind: opportunity.kind, side: opportunity.side } : {}),
    outcome,
    ...(rejectedAt ? { rejectedAt } : {}),
    steps,
  };
}

/**
 * The result of a check run, for people. A mutation run fails its tests on
 * purpose: on the refactor, a failed run means the new tests caught the
 * planted bug. On main, for new coverage, the old tests must miss it.
 */
export function checkRunRow(run: CheckRun, active: boolean): CheckRunRow {
  const outcome = (): CheckRunRow['outcome'] => {
    if (run.status === 'running') return active ? { tone: 'run', text: 'running' } : { tone: 'stop', text: 'stopped' };
    if (run.purpose !== 'mutation')
      return run.status === 'passed' ? { tone: 'ok', text: 'passed' } : { tone: 'bad', text: 'failed' };
    const caught = run.status === 'failed';
    if (run.branch === 'main')
      return caught ? { tone: 'bad', text: 'old tests catch it' } : { tone: 'ok', text: 'old tests miss it' };
    return caught ? { tone: 'ok', text: 'bug caught' } : { tone: 'bad', text: 'bug missed' };
  };
  const result = outcome();
  return { ...run, outcome: result, problem: result.tone === 'bad' && run.purpose !== 'refactorer' };
}

/** The numbers of the whole project. Each page reads them from here, so two pages cannot disagree. */
export function projectSummary(input: {
  project: string;
  now: Date;
  patrol: { lastSha?: string; lastCycleAt?: string; cycles: number };
  statuses: LiveStatus[];
  opportunities: Opportunity[];
  refactors: RefactorRow[];
  checkRuns: CheckRunRow[];
  scorecards: Scorecard[];
  sessions: SessionRow[];
  cycles: Cycle[];
}) {
  const { refactors, checkRuns, opportunities, sessions } = input;
  const now = input.now.getTime();
  const count = <T>(list: T[], test: (item: T) => boolean) => list.filter(test).length;
  const recent = (iso?: string) => !!iso && now - Date.parse(iso) < 7 * DAY;

  // Main: the newest finished run of the checks on the patrolled commit.
  const baseRuns = checkRuns.filter((r) => r.purpose === 'base');
  const lastBase = baseRuns.findLast((r) => r.outcome.tone !== 'stop');
  const main = lastBase
    ? {
        sha: lastBase.sha,
        state: lastBase.status,
        runId: lastBase.id,
        at: lastBase.finishedAt ?? lastBase.startedAt,
        ...(lastBase.status === 'failed' ? { failed: lastBase.results.find((r) => !r.ok)?.name ?? 'a check' } : {}),
      }
    : undefined;
  const blocked = main?.state === 'failed';

  const outcomes = (outcome: Outcome) => count(refactors, (r) => r.outcome === outcome);
  const judged = refactors.filter((r) => ['waits', 'rejected', 'merged', 'closed'].includes(r.outcome));
  const kept = count(judged, (r) => r.outcome !== 'rejected');
  const rejectedBy = new Map<string, number>();
  for (const r of refactors) if (r.rejectedAt) rejectedBy.set(r.rejectedAt, (rejectedBy.get(r.rejectedAt) ?? 0) + 1);
  const toPublish = refactors.filter((r) => r.status === 'verified');
  const toReview = refactors.filter((r) => r.status === 'published');

  const open = opportunities.filter((o) => o.status === 'open' && !toPublish.some((r) => r.opportunityId === o.id));
  const working = new Set(refactors.filter((r) => r.outcome === 'working').map((r) => r.opportunityId));
  const ready = pickOpportunities(opportunities, refactors, {
    count: Number.POSITIVE_INFINITY,
    maxOpen: Number.POSITIVE_INFINITY,
  }).filter((o) => !working.has(o.id));
  const byStrength: Record<Strength, number> = { strong: 0, 'worth-exploring': 0, speculative: 0 };
  for (const o of open) byStrength[o.strength]++;

  const patrolStatus = input.statuses.find((s) => s.role === 'patrol');
  const runningStatus = input.statuses.find((s) => s.alive && s.state === 'running' && s.role !== 'patrol');
  const activity: { state: 'running' | 'waiting' | 'stopped'; text: string; detail: string } =
    patrolStatus?.alive && patrolStatus.state === 'running'
      ? { state: 'running', text: 'Patrol runs', detail: patrolStatus.detail }
      : runningStatus
        ? { state: 'running', text: `${capital(runningStatus.role)} runs`, detail: runningStatus.detail }
        : patrolStatus?.alive
          ? { state: 'waiting', text: 'Patrol waits', detail: patrolStatus.detail }
          : { state: 'stopped', text: 'Not running', detail: 'No Sloppatrol process runs now.' };

  const lastCycle = input.cycles.at(-1);
  const cycle = lastCycle
    ? cycleResult(lastCycle)
    : input.patrol.lastCycleAt
      ? { at: input.patrol.lastCycleAt, tone: 'info' as Tone, text: 'Finished' }
      : undefined;

  const quality = qualityOf(input.scorecards);
  const failedSessions = sessions.filter((s) => s.state === 'failed' && recent(s.startedAt));
  const stale = input.statuses.filter((s) => s.stale);
  const interrupted = refactors.filter((r) => r.outcome === 'interrupted' && r.status === 'working');

  const attention: AttentionItem[] = [];
  if (main && blocked)
    attention.push({
      tone: 'fail',
      title: `The check ${main.failed} fails on main`,
      detail: `Commit ${main.sha.slice(0, 10)}. No refactor can be verified until the checks pass on main. Fix main, then run the checks again.`,
      command: 'sloppatrol check',
      target: { tab: 'checks', select: `check:${main.runId}` },
    });
  if (interrupted.length || stale.length)
    attention.push({
      tone: 'warn',
      title: 'Sloppatrol stopped during its work',
      detail: interrupted.length
        ? `${plural(interrupted.length, 'refactor')} did not finish. The next patrol cleans up the worktree and tries again.`
        : `The ${stale.map((s) => s.role).join(', ')} stopped without an end. The next patrol cleans up.`,
      command: 'sloppatrol',
      target: { tab: 'refactors', filter: 'error' },
    });
  if (toPublish.length)
    attention.push({
      tone: 'warn',
      title: `${plural(toPublish.length, 'verified refactor')} ${toPublish.length === 1 ? 'waits' : 'wait'} to be published`,
      detail:
        toPublish.length === 1
          ? 'The gate kept it. Publish it to open its pull request.'
          : 'The gate kept them. Publish them to open a pull request for each.',
      command: 'sloppatrol publish',
      target: { tab: 'refactors', filter: 'waits' },
      links: toPublish.map((r) => ({ label: r.title, href: '', select: `refactor:${r.id}` })),
    });
  if (toReview.length)
    attention.push({
      tone: 'info',
      title: `${plural(toReview.length, 'pull request')} ${toReview.length === 1 ? 'waits' : 'wait'} for your review`,
      detail: 'Merge a pull request to keep the change. Close it to dismiss the opportunity for good.',
      target: { tab: 'refactors', filter: 'waits' },
      links: toReview.map((r) => ({ label: r.title, href: r.prUrl ?? '', select: `refactor:${r.id}` })),
    });
  if (failedSessions.length)
    attention.push({
      tone: 'warn',
      title: `${plural(failedSessions.length, 'agent session')} failed in the last 7 days`,
      detail: `Last error: ${failedSessions.at(-1)!.last}`,
      command: 'sloppatrol doctor',
      target: { tab: 'sessions', filter: 'failed' },
    });
  if (main && !blocked && !open.length && opportunities.length)
    attention.push({
      tone: 'info',
      title: 'The backlog is empty',
      detail: 'The refactorer has no open opportunity. The surveyor records more when the backlog is low.',
      command: 'sloppatrol survey',
      target: { tab: 'backlog' },
    });

  const started = !!(
    main ||
    refactors.length ||
    opportunities.length ||
    input.scorecards.length ||
    input.cycles.length
  );
  const errors = interrupted.length + stale.length + failedSessions.length > 0;
  const waiting = toPublish.length + toReview.length;
  const verdict: { tone: Tone; text: string; detail: string } = !started
    ? { tone: 'info', text: 'Not started', detail: 'Sloppatrol has not run on this repo yet.' }
    : blocked
      ? { tone: 'fail', text: 'Blocked', detail: 'The checks fail on main, so no refactor can be verified.' }
      : errors
        ? { tone: 'warn', text: 'Needs a look', detail: 'Some work stopped with an error.' }
        : waiting
          ? {
              tone: 'warn',
              text: 'Waits for you',
              detail: `${plural(waiting, 'refactor')} ${waiting === 1 ? 'waits' : 'wait'} for a decision.`,
            }
          : !main
            ? { tone: 'info', text: 'No checks yet', detail: 'The checks have not run on main yet.' }
            : { tone: 'pass', text: 'Healthy', detail: 'The checks pass on main, and nothing waits for you.' };

  const mutationRuns = checkRuns.filter(
    (r) => r.purpose === 'mutation' && r.branch !== 'main' && r.outcome.tone !== 'run',
  );
  const byPurpose = (purpose: CheckRun['purpose']) => {
    const list = checkRuns.filter((r) => r.purpose === purpose);
    return {
      runs: list.length,
      bad: count(list, (r) => r.outcome.tone === 'bad'),
      problems: count(list, (r) => r.problem),
    };
  };
  const cost = (list: SessionRow[]) => Math.round(list.reduce((sum, s) => sum + s.costUsd, 0) * 100) / 100;

  return {
    project: input.project,
    verdict,
    activity,
    ...(main ? { main } : {}),
    cycles: { count: input.patrol.cycles, ...(cycle ? { last: cycle } : {}) },
    refactors: {
      total: refactors.length,
      working: outcomes('working'),
      waits: outcomes('waits'),
      rejected: outcomes('rejected'),
      error: outcomes('error') + outcomes('interrupted'),
      merged: outcomes('merged'),
      closed: outcomes('closed'),
      judged: judged.length,
      kept,
      ...(judged.length ? { keptRate: Math.round((kept / judged.length) * 100) } : {}),
      rejectedBy: [...rejectedBy]
        .map(([step, n]) => ({ step, label: STEP_LABELS[step as StepId], count: n }))
        .sort((a, b) => b.count - a.count),
    },
    decisions: { toPublish: toPublish.length, toReview: toReview.length },
    backlog: {
      total: opportunities.length,
      open: open.length,
      /** The open opportunities in the order the refactorer picks them. */
      ready: ready.map((o) => o.id),
      /** Open, but a waiting refactor changes one of its files. */
      busy: open.filter((o) => !ready.includes(o) && !working.has(o.id)).map((o) => o.id),
      /** Open, and a refactor works on it now. */
      working: [...working],
      byStrength,
      verified: toPublish.length,
      proposed: count(opportunities, (o) => o.status === 'proposed'),
      done: count(opportunities, (o) => o.status === 'done'),
      exhausted: count(opportunities, (o) => o.status === 'exhausted'),
      dismissed: count(opportunities, (o) => o.status === 'dismissed'),
    },
    ...(quality ? { quality } : {}),
    checks: {
      runs: checkRuns.length,
      problems: count(checkRuns, (r) => r.problem),
      base: byPurpose('base'),
      gate: byPurpose('gate'),
      refactorer: byPurpose('refactorer'),
      mutation: byPurpose('mutation'),
      ...(mutationRuns.length
        ? { caught: count(mutationRuns, (r) => r.outcome.tone === 'ok'), planted: mutationRuns.length }
        : {}),
    },
    sessions: {
      total: sessions.length,
      running: count(sessions, (s) => s.state === 'running'),
      failed: count(sessions, (s) => s.state === 'failed'),
      failedRecent: failedSessions.length,
      stopped: count(sessions, (s) => s.state === 'stopped'),
      costUsd: cost(sessions),
      costRecentUsd: cost(sessions.filter((s) => recent(s.startedAt))),
      byRole: Object.fromEntries(
        [...new Set(sessions.map((s) => s.role))].map((role) => [role, count(sessions, (s) => s.role === role)]),
      ),
    },
    attention,
  };
}

function cycleResult(cycle: Cycle): { at: string; tone: Tone; text: string; sha?: string } {
  const kept = cycle.refactors.filter((r) => r.status === 'verified').length;
  const parts = [
    cycle.surveyed ? `${plural(cycle.surveyed, 'opportunity', 'opportunities')} found` : '',
    cycle.refactors.length ? `${kept} of ${plural(cycle.refactors.length, 'refactor')} kept` : '',
    cycle.published ? `${plural(cycle.published, 'pull request')} opened` : '',
  ].filter(Boolean);
  const base = { at: cycle.finishedAt, ...(cycle.sha ? { sha: cycle.sha } : {}) };
  if (cycle.error) return { ...base, tone: 'fail', text: `Failed: ${cycle.error}` };
  if (cycle.blocked) return { ...base, tone: 'fail', text: 'Blocked: the checks fail on main' };
  return {
    ...base,
    tone: kept || cycle.published ? 'pass' : 'info',
    text: parts.length ? capital(parts.join(', ')) : 'No new work',
  };
}

/**
 * The newest scorecard, with the change since the one before. The change
 * compares like with like: only the files that both scorecards scored, so
 * a file that joins the panel does not read as a change in quality.
 */
function qualityOf(scorecards: Scorecard[]) {
  const current = scorecards.at(-1);
  if (!current) return undefined;
  const previous = scorecards.at(-2);
  const before = new Map(previous?.units.map((u) => [u.path, u]) ?? []);
  const common = current.units.filter((u) => before.has(u.path));
  const now = meanScores(common);
  const then = meanScores(common.map((u) => before.get(u.path)!));
  const shared = (Object.keys(now) as MetricId[]).filter((id) => then[id] !== undefined);
  const pick = (means: Partial<Record<MetricId, number>>) => Object.fromEntries(shared.map((id) => [id, means[id]]));
  const overallNow = overallPercent(pick(now));
  const overallThen = overallPercent(pick(then));
  const c = current.coverage;
  const overall = overallPercent(current.means);
  const scored = (current.guardrails ?? []).filter((g) => !g.informational);
  return {
    sha: current.sha,
    at: current.at,
    rubric: current.rubric,
    ...(overall !== undefined ? { overall } : {}),
    ...(overallNow !== undefined && overallThen !== undefined ? { delta: overallNow - overallThen } : {}),
    /** The files that both of the last two scorecards scored: the change compares these only. */
    compared: common.length,
    trend: scorecards.map((card) => overallPercent(card.means)).filter((v): v is number => v !== undefined),
    metrics: METRICS.filter((m) => current.means[m.id] !== undefined).map((m) => ({
      id: m.id,
      name: m.name,
      value: toPercent(current.means[m.id]!),
      ...(shared.includes(m.id) ? { delta: toPercent(now[m.id]!) - toPercent(then[m.id]!) } : {}),
      trend: scorecards
        .map((card) => card.means[m.id])
        .filter((v): v is number => v !== undefined)
        .map(toPercent),
    })),
    coverage: {
      files: c.files,
      totalFiles: c.totalFiles,
      share: c.totalLines ? Math.round((c.lines / c.totalLines) * 100) : 0,
    },
    guardrails: {
      present: scored.filter((g) => g.present).length,
      total: scored.length,
    },
  };
}

function plural(n: number, word: string, many = `${word}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? word : many}`;
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
