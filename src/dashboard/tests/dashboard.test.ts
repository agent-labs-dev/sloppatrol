import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Dashboard, type DashboardState, startDashboard } from '../../dashboard/index.js';
import type { CheckRun } from '../../domain/index.js';
import { Store } from '../../store/index.js';

describe('the dashboard', () => {
  let dir: string;
  let dashboard: Dashboard;
  const get = (path: string) => fetch(`${dashboard.url}${path}`);

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'sloppatrol-dashboard-'));
    const store = new Store(dir);
    await store.saveCheckRun({
      id: '20261028T120000000-abcd',
      purpose: 'gate',
      sha: 'a'.repeat(40),
      refactorId: 'r1',
      branch: 'sloppatrol/simplify-x',
      status: 'failed',
      checksKey: 'k',
      results: [
        { name: 'test', command: 'pnpm test', ok: false, exitCode: 1, durationMs: 1200, output: 'x'.repeat(5000) },
      ],
      startedAt: '2026-10-28T12:00:00.000Z',
      finishedAt: '2026-10-28T12:00:01.200Z',
    });
    await store.setStatus({ role: 'refactorer', state: 'running', detail: 'Running on claude' });
    await store.appendEvent({
      at: '2026-10-28T12:00:00.000Z',
      sessionId: 's1-refactorer',
      role: 'refactorer',
      kind: 'start',
      summary: 'refactorer started.',
    });
    dashboard = await startDashboard({ store, project: 'shop', port: 0 });
  });
  afterAll(async () => {
    await dashboard.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('serves the page', async () => {
    const page = await get('/');
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('<script src="/app.js"');
  });

  it('serves one snapshot of the agents, the check runs and the sessions', async () => {
    const state = (await (await get('/api/state')).json()) as DashboardState;
    expect(state.project).toBe('shop');
    expect(state.statuses).toMatchObject([{ role: 'refactorer', state: 'running' }]);
    expect(state.sessions).toMatchObject([{ id: 's1-refactorer', role: 'refactorer', state: 'running' }]);
    // The snapshot keeps only the end of a failed output; the full run is one request away.
    expect(state.checkRuns[0]?.results[0]?.output).toHaveLength(600);
    const run = (await (await get('/api/checks/20261028T120000000-abcd')).json()) as CheckRun;
    expect(run.results[0]?.output).toHaveLength(5000);
  });

  it('answers 404 for anything else', async () => {
    expect((await get('/api/checks/..%2F..%2Fsecret')).status).toBe(404);
    expect((await get('/api/checks/missing')).status).toBe(404);
    expect((await get('/etc/passwd')).status).toBe(404);
  });
});
