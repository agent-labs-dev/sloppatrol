import { readFile } from 'node:fs/promises';
import { createServer, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Store } from '../store/index.js';
import { snapshot } from './lib/snapshot.js';

export type { DashboardState } from './lib/snapshot.js';

/** Shipped in the npm package next to `dist/`. */
const UI = fileURLToPath(new URL('../../ui/', import.meta.url));
const STATIC: Record<string, [string, string]> = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};
const ID = /^[A-Za-z0-9-]+$/;

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

export type Dashboard = { url: string; close(): Promise<void> };

/**
 * A read-only local page over the store: the agents, the backlog, the
 * refactors and their gate, and every check run, refreshed live.
 */
export async function startDashboard(options: { store: Store; project: string; port?: number }): Promise<Dashboard> {
  const { store } = options;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const file = STATIC[url.pathname];
      if (file) {
        response.writeHead(200, { 'content-type': file[1], 'cache-control': 'no-store' });
        response.end(await readFile(`${UI}${file[0]}`));
        return;
      }
      if (url.pathname === '/api/state') return json(response, 200, await snapshot(store, options.project));
      const [, api, kind, id] = url.pathname.split('/');
      if (api === 'api' && id && ID.test(id)) {
        if (kind === 'sessions') return json(response, 200, await store.events(id));
        if (kind === 'checks') {
          const run = (await store.listCheckRuns()).find((r) => r.id === id);
          return run ? json(response, 200, run) : json(response, 404, { error: 'not found' });
        }
      }
      json(response, 404, { error: 'not found' });
    } catch (error) {
      json(response, 500, { error: (error as Error).message });
    }
  });
  await new Promise<void>((done, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 4322, '127.0.0.1', () => done());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}
