import type { AgentEvent, CheckRun } from '../../domain/index.js';
import { METRICS } from '../../metrics/index.js';
import type { Store } from '../../store/index.js';
import {
  checkRunRow,
  type LiveStatus,
  type ProjectSummary,
  projectSummary,
  refactorRow,
  type SessionRow,
} from './summary.js';

const RECENT_SESSIONS = 60;
const RECENT_CHECKS = 80;
const RECENT_SCORECARDS = 30;

/** True when a process with this id runs. EPERM: it runs, as another user. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function sessionRow(id: string, events: AgentEvent[], active: boolean): SessionRow | undefined {
  const first = events[0];
  const last = events.at(-1);
  if (!first || !last) return undefined;
  const ended = last.kind === 'finish' || last.kind === 'error';
  return {
    id,
    role: first.role,
    ...(first.subject ? { subject: first.subject } : {}),
    startedAt: first.at,
    ...(ended ? { endedAt: last.at } : {}),
    // An interrupted session ended because Sloppatrol stopped, not because the agent failed.
    state:
      !ended || /^Interrupted/.test(last.summary)
        ? !ended && active
          ? 'running'
          : 'stopped'
        : last.kind === 'error'
          ? 'failed'
          : 'done',
    last: last.summary.split('\n')[0]!.slice(0, 200),
    costUsd: events.reduce((sum, e) => sum + (e.kind === 'finish' || e.kind === 'error' ? (e.costUsd ?? 0) : 0), 0),
  };
}

/** A check run without the long outputs; the page fetches one run in full on demand. */
function light<T extends CheckRun>(run: T): T {
  return { ...run, results: run.results.map((r) => ({ ...r, output: r.ok ? '' : r.output.slice(-600) })) };
}

export type DashboardState = Awaited<ReturnType<ReturnType<typeof snapshots>['state']>>;

/**
 * Reads the store for the dashboard. A session that ended never changes, so
 * its row is read once; the counts still cover every session.
 */
export function snapshots(store: Store, project: string, alive: (pid: number) => boolean = processAlive) {
  const ended = new Map<string, SessionRow>();
  const sessionRows = async (ids: string[], active: boolean) =>
    (
      await Promise.all(
        ids.map(async (id) => {
          const known = ended.get(id);
          if (known) return known;
          const row = sessionRow(id, await store.events(id), active);
          if (row?.endedAt) ended.set(id, row);
          return row;
        }),
      )
    ).filter((row): row is SessionRow => !!row);

  const read = async () => {
    const [patrol, rawStatuses, opportunities, refactors, checkRuns, sessionIds, scorecards, cycles] =
      await Promise.all([
        store.patrolState(),
        store.statuses(),
        store.listOpportunities(),
        store.listRefactors(),
        store.listCheckRuns(),
        store.sessions(),
        store.listScorecards(),
        store.listCycles(),
      ]);
    const statuses: LiveStatus[] = rawStatuses.map((s) => {
      const running = alive(s.pid);
      return { ...s, alive: running, stale: s.state === 'running' && !running };
    });
    // Work marked as running is real only while a Sloppatrol process runs.
    const active = statuses.some((s) => s.alive);
    const byId = new Map(opportunities.map((o) => [o.id, o]));
    const refactorRows = refactors.map((r) => refactorRow(r, byId.get(r.opportunityId), checkRuns, active));
    const runRows = checkRuns.map((run) => checkRunRow(run, active));
    const sessions = await sessionRows(sessionIds, active);
    const now = new Date();
    const summary = projectSummary({
      project,
      now,
      patrol,
      statuses,
      opportunities,
      refactors: refactorRows,
      checkRuns: runRows,
      scorecards,
      sessions,
      cycles,
    });
    return { now, patrol, statuses, opportunities, refactorRows, runRows, sessions, scorecards, summary };
  };

  return {
    async summary(): Promise<ProjectSummary> {
      return (await read()).summary;
    },
    /** Everything the dashboard shows, in one read of the store. */
    async state() {
      const data = await read();
      return {
        project,
        now: data.now.toISOString(),
        summary: data.summary,
        patrol: data.patrol,
        statuses: data.statuses,
        opportunities: data.opportunities.reverse(),
        // The gate's check outputs are one request away, in their check run.
        refactors: data.refactorRows
          .reverse()
          .map((r) =>
            r.verdict
              ? { ...r, verdict: { ...r.verdict, checks: r.verdict.checks.map((c) => ({ ...c, output: '' })) } }
              : r,
          ),
        checkRuns: data.runRows.slice(-RECENT_CHECKS).reverse().map(light),
        sessions: data.sessions.slice(-RECENT_SESSIONS).reverse(),
        // Every file's scores for the newest scorecard only: older ones feed the
        // trend, which needs their means alone. Oldest first.
        scorecards: data.scorecards
          .slice(-RECENT_SCORECARDS)
          .map((card, i, all) => (i === all.length - 1 ? card : { ...card, units: [] })),
        metrics: METRICS.map((m) => ({ id: m.id, name: m.name, question: m.question, levels: m.levels })),
      };
    },
  };
}
