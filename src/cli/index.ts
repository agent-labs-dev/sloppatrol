#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRuntime } from '../agents/index.js';
import { censusMarkdown, takeCensus } from '../census/index.js';
import { ConfigError, loadConfig } from '../config/index.js';
import { type Dashboard, startDashboard } from '../dashboard/index.js';
import { verdictMarkdown } from '../gate/index.js';
import { GhCliGitHub } from '../github/index.js';
import {
  openBase,
  type PatrolDeps,
  patrol,
  proofMarkdown,
  publish,
  refactorNow,
  scoreNow,
  surveyNow,
} from '../patrol/index.js';
import { stopAll } from '../processes/index.js';
import { scorecardMarkdown } from '../roles/index.js';
import { Store } from '../store/index.js';
import { intFlag, parseArgv, strFlag } from './lib/argv.js';
import { openInBrowser } from './lib/browser.js';
import { doctor } from './lib/doctor.js';
import { init } from './lib/init.js';
import { status } from './lib/status.js';
import { USAGE } from './lib/usage.js';

const EXIT = { ok: 0, failed: 1, config: 2 } as const;
const log = (line: string) => process.stderr.write(`${line}\n`);
const out = (line: string) => process.stdout.write(`${line}\n`);

function version(): string {
  const file = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(file, 'utf8')) as { version: string }).version;
}

/** The composition root: the only place that picks the real adapters. */
async function wire(cwd: string) {
  const loaded = await loadConfig(cwd);
  const deps: PatrolDeps = {
    store: new Store(loaded.dir),
    github: new GhCliGitHub(loaded.source, loaded.config.github.repo),
    runtimeFor: createRuntime,
    log,
  };
  return { loaded, deps };
}

/** The dashboard on the asked port, or on any free port when that one is taken. */
async function dashboard(store: Store, project: string, port: number | undefined): Promise<Dashboard> {
  try {
    return await startDashboard({ store, project, port: port ?? 4322 });
  } catch (error) {
    if (port !== undefined || (error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    return startDashboard({ store, project, port: 0 });
  }
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

/**
 * Ctrl-C or a SIGTERM stops every check and agent CLI Sloppatrol started,
 * marks the running agents stopped, and exits. The next patrol cleans up
 * the interrupted refactor. Returns a function that removes the handlers.
 */
function stopOnSignal(store: Store): () => void {
  const stop = async (signal: NodeJS.Signals) => {
    stopAll();
    log(`sloppatrol: stopped (${signal}).`);
    for (const status of await store.statuses())
      if (status.state === 'running') await store.setStatus({ role: status.role, state: 'idle', detail: 'Stopped.' });
    process.exit(130);
  };
  for (const signal of SIGNALS) process.once(signal, stop);
  return () => {
    for (const signal of SIGNALS) process.off(signal, stop);
  };
}

function untilSigint(): Promise<void> {
  return new Promise((done) => process.once('SIGINT', () => done()));
}

async function main(args: string[]): Promise<number> {
  const { command, positional, flags } = parseArgv(args);
  const cwd = resolve(strFlag(flags, 'cwd') ?? process.cwd());
  if (flags.version) {
    out(version());
    return EXIT.ok;
  }
  if (flags.help || command === 'help') {
    out(USAGE);
    return EXIT.ok;
  }
  if (command === 'init') {
    await init(cwd, strFlag(flags, 'agent') ?? 'auto', log);
    return EXIT.ok;
  }
  const { loaded, deps } = await wire(cwd);
  const { store } = deps;
  switch (command) {
    case 'doctor':
      return (await doctor(loaded, out)) ? EXIT.ok : EXIT.config;
    case 'check': {
      stopOnSignal(store);
      const base = await openBase(loaded, deps, { recheck: true });
      for (const r of base.checks.results) out(`${r.ok ? '✓' : '✗'} ${r.name} (${(r.durationMs / 1000).toFixed(1)}s)`);
      if (base.blocked) {
        const failed = base.checks.results.find((r) => !r.ok);
        if (failed) out(`\n${failed.output}`);
        out(`\n${base.blocked}`);
        return EXIT.failed;
      }
      out(`\nThe checks pass on ${base.sha.slice(0, 10)}. Sloppatrol can verify refactors.`);
      return EXIT.ok;
    }
    case 'survey': {
      stopOnSignal(store);
      const result = await surveyNow(loaded, deps);
      for (const o of result.recorded) out(`${o.id}  ${o.strength.padEnd(15)}  ${o.kind.padEnd(22)}  ${o.title}`);
      out(`${result.recorded.length} opportunit${result.recorded.length === 1 ? 'y' : 'ies'} recorded.`);
      return result.stop === 'error' ? EXIT.failed : EXIT.ok;
    }
    case 'refactor': {
      stopOnSignal(store);
      const refactor = await refactorNow(loaded, deps, positional[0]);
      out(`${refactor.id}: ${refactor.status}${refactor.reason ? ` - ${refactor.reason.split('\n')[0]}` : ''}`);
      if (refactor.proof) out(`\n${proofMarkdown(refactor.proof)}`);
      else if (refactor.verdict) out(`\n${verdictMarkdown(refactor.verdict)}`);
      if (refactor.status === 'verified')
        out(`\nBranch ${refactor.branch}. Run \`sloppatrol publish\` to open the pull request.`);
      return refactor.status === 'verified' ? EXIT.ok : EXIT.failed;
    }
    case 'score': {
      const unwatch = stopOnSignal(store);
      out(scorecardMarkdown(await scoreNow(loaded, deps, intFlag(flags, 'files'))));
      unwatch();
      if (flags.dashboard === false) return EXIT.ok;
      const server = await dashboard(store, loaded.config.project.name, intFlag(flags, 'port'));
      const page = `${server.url}/#share`;
      out(`\nThe scorecard, ready to share: ${page}\nCtrl-C stops the dashboard.`);
      if (flags.open !== false) openInBrowser(page);
      await untilSigint();
      await server.close();
      return EXIT.ok;
    }
    case 'status':
      await status(store, out);
      return EXIT.ok;
    case 'census':
      out(censusMarkdown(await takeCensus(loaded.source, loaded.config)));
      return EXIT.ok;
    case 'dismiss': {
      const opportunity = await store.getOpportunity(positional[0] ?? '');
      if (!opportunity) throw new ConfigError(`Unknown opportunity ${positional[0] ?? ''}`);
      const reason = strFlag(flags, 'reason');
      if (!reason) throw new ConfigError('Give a --reason.');
      await store.saveOpportunity({ ...opportunity, status: 'dismissed', reason, updatedAt: new Date().toISOString() });
      out(`Dismissed ${opportunity.id}.`);
      return EXIT.ok;
    }
    case 'publish': {
      const result = await publish(loaded, { ...deps, log: out }, flags['dry-run'] === true || undefined);
      for (const url of result.urls) out(url);
      for (const error of result.errors) log(error);
      if (result.dryRun && !flags['dry-run']) log('github.enabled is false: this was a dry run.');
      return result.errors.length ? EXIT.failed : EXIT.ok;
    }
    case 'dashboard': {
      const server = await dashboard(store, loaded.config.project.name, intFlag(flags, 'port'));
      out(`Sloppatrol dashboard: ${server.url}`);
      await untilSigint();
      await server.close();
      return EXIT.ok;
    }
    default: {
      const server =
        flags.dashboard === false
          ? undefined
          : await dashboard(store, loaded.config.project.name, intFlag(flags, 'port'));
      if (server) log(`Sloppatrol dashboard: ${server.url}`);
      stopOnSignal(store);
      try {
        await patrol(() => loadConfig(cwd), deps, { once: Boolean(flags.once) });
      } finally {
        await server?.close();
      }
      return EXIT.ok;
    }
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  log(`sloppatrol: ${(error as Error).message}`);
  process.exitCode = error instanceof ConfigError ? EXIT.config : EXIT.failed;
}
