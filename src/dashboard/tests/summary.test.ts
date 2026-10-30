import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type DashboardState, type ProjectSummary, startDashboard } from '../../dashboard/index.js';
import { type FixtureShape, writeFixture } from './fixtures.js';

/**
 * The numbers each page shows, read through the server from the demo data.
 * The fixtures mark live work with process 1, so `alive` decides whether a
 * Sloppatrol process runs.
 */
describe('the project summary', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function serve(shape: FixtureShape, alive: (pid: number) => boolean = (pid) => pid === 1) {
    const dir = mkdtempSync(join(tmpdir(), `sloppatrol-summary-${shape}-`));
    dirs.push(dir);
    const store = await writeFixture(dir, shape);
    const dashboard = await startDashboard({ store, project: 'storefront', port: 0, alive });
    try {
      const get = async <T>(path: string) => (await (await fetch(`${dashboard.url}${path}`)).json()) as T;
      return { summary: await get<ProjectSummary>('/api/summary'), state: await get<DashboardState>('/api/state') };
    } finally {
      await dashboard.close();
    }
  }

  it('says that an empty project has not started, with nothing to attend to', async () => {
    const { summary } = await serve('empty');
    expect(summary.verdict).toMatchObject({ tone: 'info', text: 'Not started' });
    expect(summary.activity.state).toBe('stopped');
    expect(summary.attention).toEqual([]);
    expect(summary.refactors.total).toBe(0);
    expect(summary.quality).toBeUndefined();
  });

  it('asks to publish the refactor that the first cycle kept, and reports that cycle', async () => {
    const { summary } = await serve('first-run');
    expect(summary.verdict).toMatchObject({ tone: 'warn', text: 'Waits for you' });
    expect(summary.attention).toMatchObject([{ command: 'sloppatrol publish', target: { filter: 'waits' } }]);
    expect(summary.cycles.last).toMatchObject({ tone: 'pass', text: '6 opportunities found, 1 of 1 refactor kept' });
    expect(summary.decisions).toEqual({ toPublish: 1, toReview: 0 });
    // The refactor that waits holds its files: its opportunity is not open, and none is busy.
    expect(summary.backlog).toMatchObject({ open: 5, busy: [], verified: 1 });
    expect(summary.backlog.ready).toHaveLength(5);
    // One scorecard: nothing to compare with.
    expect(summary.quality).toMatchObject({ compared: 0 });
    expect(summary.quality?.delta).toBeUndefined();
  });

  it('blocks on red checks on main, and points to the run that failed', async () => {
    const { summary, state } = await serve('blocked');
    const failed = state.checkRuns.find((r) => r.purpose === 'base' && r.status === 'failed')!;
    expect(summary.verdict).toMatchObject({ tone: 'fail', text: 'Blocked' });
    expect(summary.main).toMatchObject({ state: 'failed', failed: 'test', runId: failed.id });
    expect(summary.attention[0]).toMatchObject({
      tone: 'fail',
      title: 'The check test fails on main',
      command: 'sloppatrol check',
      target: { tab: 'checks', select: `check:${failed.id}` },
    });
    expect(summary.cycles.last).toMatchObject({ tone: 'fail', text: 'Blocked: the checks fail on main' });
    expect(summary.activity.state).toBe('waiting');
  });

  it('counts each refactor once, by its result and by the step that rejected it', async () => {
    const { summary, state } = await serve('busy');
    expect(summary.refactors).toMatchObject({
      total: 18,
      working: 1,
      waits: 3,
      rejected: 6,
      error: 2,
      merged: 5,
      closed: 1,
      judged: 15,
      kept: 9,
      keptRate: 60,
    });
    expect(Object.fromEntries(summary.refactors.rejectedBy.map((r) => [r.step, r.count]))).toEqual({
      checks: 2,
      guards: 1,
      mutation: 1,
      metrics: 1,
      review: 1,
    });
    // An old rejection keeps its steps from its own verdict.
    const guards = state.refactors.find((r) => r.rejectedAt === 'guards')!;
    expect(guards.steps.map((s) => s.state)).toEqual(['ok', 'bad', '', '', '', '']);
    expect(state.refactors.find((r) => r.status === 'verified')?.steps.at(-1)).toMatchObject({ state: 'wait' });
    expect(summary.attention.map((a) => a.title)).toEqual([
      '1 verified refactor waits to be published',
      '2 pull requests wait for your review',
      '2 agent sessions failed in the last 7 days',
    ]);
  });

  it('reads a planted bug that a mutation run caught as a pass, and a red refactorer try as no problem', async () => {
    const { summary, state } = await serve('busy');
    const mutations = state.checkRuns.filter((r) => r.purpose === 'mutation');
    expect(mutations.map((r) => [r.status, r.outcome.text, r.problem])).toEqual(
      expect.arrayContaining([
        ['failed', 'bug caught', false],
        ['passed', 'bug missed', true],
      ]),
    );
    const tries = state.checkRuns.filter((r) => r.purpose === 'refactorer' && r.status === 'failed');
    expect(tries.length).toBeGreaterThan(0);
    expect(tries.every((r) => !r.problem)).toBe(true);
    expect(summary.checks.problems).toBe(state.checkRuns.filter((r) => r.problem).length);
    expect(summary.checks).toMatchObject({ caught: 2, planted: 3 });
  });

  it('compares the quality with the scorecard before, over the files that both scored', async () => {
    const { summary, state } = await serve('busy');
    // The page gets the files of the newest scorecard only, but the change still compares like with like.
    expect(state.scorecards.at(-2)?.units).toEqual([]);
    expect(summary.quality).toMatchObject({ overall: 81, delta: 2, compared: 24 });
    expect(summary.quality?.trend).toHaveLength(12);
    expect(summary.quality?.metrics.find((m) => m.id === 'modularity')).toMatchObject({ value: 80, delta: 4 });
  });

  it('orders the open backlog as the refactorer picks it, and holds back the one that shares a busy file', async () => {
    const { summary, state } = await serve('busy');
    const title = (id: string) => state.opportunities.find((o) => o.id === id)?.title;
    expect(summary.backlog.ready.slice(0, 2).map(title)).toEqual([
      'Pass the database client into the stock module',
      'Remove the unused legacy label printer',
    ]);
    expect(summary.backlog.busy.map(title)).toEqual(['Type the middleware context']);
    expect(summary.backlog.working.map(title)).toEqual(['Test the session with a fake store, not a mock']);
  });

  it('shows work as stopped when no Sloppatrol process runs, also when the files still say running', async () => {
    const { summary, state } = await serve('busy', () => false);
    expect(summary.activity).toMatchObject({ state: 'stopped', text: 'Not running' });
    expect(state.statuses.find((s) => s.role === 'refactorer')).toMatchObject({ state: 'running', stale: true });
    expect(state.refactors.find((r) => r.status === 'working')?.outcome).toBe('interrupted');
    expect(state.checkRuns.find((r) => r.status === 'running')?.outcome).toEqual({ tone: 'stop', text: 'stopped' });
    expect(summary.sessions).toMatchObject({ running: 0, stopped: 2 });
    expect(summary.verdict.text).toBe('Needs a look');
    expect(summary.attention[0]).toMatchObject({ title: 'Sloppatrol stopped during its work', command: 'sloppatrol' });
  });

  it('serves one summary to every page: the state holds the same numbers as /api/summary', async () => {
    const { summary, state } = await serve('busy');
    expect(state.summary).toEqual(summary);
  });
});
