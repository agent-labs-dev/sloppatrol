import type { AgentEvent, CheckRun } from '../../domain/index.js';
import { METRICS } from '../../metrics/index.js';
import type { Store } from '../../store/index.js';

export type SessionSummary = {
  id: string;
  role: AgentEvent['role'];
  subject?: string;
  startedAt: string;
  endedAt?: string;
  state: 'running' | 'done' | 'failed';
  last: string;
  costUsd: number;
};

const RECENT_SESSIONS = 40;
const RECENT_CHECKS = 60;
const RECENT_SCORECARDS = 30;

async function summarize(store: Store, id: string): Promise<SessionSummary | undefined> {
  const events = await store.events(id);
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) return undefined;
  const ended = last.kind === 'finish' || last.kind === 'error';
  return {
    id,
    role: first.role,
    subject: first.subject,
    startedAt: first.at,
    endedAt: ended ? last.at : undefined,
    state: !ended ? 'running' : last.kind === 'error' ? 'failed' : 'done',
    last: last.summary.split('\n')[0]!.slice(0, 200),
    costUsd: events.reduce((sum, e) => sum + (e.kind === 'finish' || e.kind === 'error' ? (e.costUsd ?? 0) : 0), 0),
  };
}

/** A check run without the long outputs; the page fetches one run in full on demand. */
function light(run: CheckRun): CheckRun {
  return { ...run, results: run.results.map((r) => ({ ...r, output: r.ok ? '' : r.output.slice(-600) })) };
}

/** Everything the dashboard shows, in one read of the store. */
export async function snapshot(store: Store, project: string) {
  const [patrol, statuses, opportunities, refactors, checkRuns, sessionIds, scorecards] = await Promise.all([
    store.patrolState(),
    store.statuses(),
    store.listOpportunities(),
    store.listRefactors(),
    store.listCheckRuns(),
    store.sessions(),
    store.listScorecards(),
  ]);
  const sessions = await Promise.all(
    sessionIds
      .slice(-RECENT_SESSIONS)
      .reverse()
      .map((id) => summarize(store, id)),
  );
  return {
    project,
    now: new Date().toISOString(),
    patrol,
    statuses,
    opportunities: opportunities.reverse(),
    refactors: refactors.reverse(),
    checkRuns: checkRuns.slice(-RECENT_CHECKS).reverse().map(light),
    sessions: sessions.filter(Boolean),
    /** Oldest first, for the trend; the last one is the current scorecard. */
    // Every file's scores for the newest scorecard only: older ones feed the
    // trend, which needs their means alone.
    scorecards: scorecards
      .slice(-RECENT_SCORECARDS)
      .map((card, i, all) => (i === all.length - 1 ? card : { ...card, units: [] })),
    metrics: METRICS.map((m) => ({ id: m.id, name: m.name, question: m.question, levels: m.levels })),
  };
}

export type DashboardState = Awaited<ReturnType<typeof snapshot>>;
