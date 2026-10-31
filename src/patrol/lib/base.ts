import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { type Census, takeCensus } from '../../census/index.js';
import type { LoadedConfig } from '../../config/index.js';
import type { CheckRun } from '../../domain/index.js';
import { checksKey, prepare, runRecordedChecks } from '../../gate/index.js';
import { checkout, removeWorktree, resolveRef } from '../../git/index.js';
import { playbookFor } from '../../playbook/index.js';
import type { RoleContext } from '../../roles/index.js';
import { readRepoRules } from '../../rules/index.js';
import type { PatrolDeps } from './deps.js';

/** The patrolled commit, checked out. */
export type Checkout = {
  sha: string;
  /** A detached checkout of `sha` that no agent edits. */
  dir: string;
};

/** The patrolled commit, checked out, with the result of its checks. */
export type Base = Checkout & {
  checks: CheckRun;
  /** Why no refactor can be verified on this commit, when none can. */
  blocked?: string;
};

/** Checks out the patrolled ref, and removes the checkouts of older commits. */
export async function checkoutBase(loaded: LoadedConfig, deps: PatrolDeps): Promise<Checkout & { fresh: boolean }> {
  const { config, source } = loaded;
  const sha = await resolveRef(source, config.patrol.pull);
  if (!sha) throw new Error(`Cannot resolve ${config.patrol.pull} in ${source}.`);
  const dir = deps.store.path('checkouts', sha.slice(0, 12));
  await pruneCheckouts(source, deps.store.path('checkouts'), dir);
  const fresh = !existsSync(dir);
  await checkout(source, dir, sha);
  return { sha, dir, fresh };
}

/**
 * Checks out the patrolled ref and runs the checks there, once per commit.
 * The checks are the oracle: on a red commit nothing can be verified.
 */
export async function openBase(
  loaded: LoadedConfig,
  deps: PatrolDeps,
  options: { recheck?: boolean } = {},
): Promise<Base> {
  const { config } = loaded;
  const { store, log } = deps;
  const { sha, dir, fresh } = await checkoutBase(loaded, deps);
  let checks = options.recheck ? undefined : await store.baseCheckRun(sha, checksKey(config.checks));
  if (!checks) {
    log(`checking ${config.patrol.pull} at ${sha.slice(0, 10)}`);
    await store.setStatus({ role: 'gate', state: 'running', detail: `Checks on ${sha.slice(0, 10)}` });
    if (fresh || options.recheck) await prepare(config.prepare, dir, log);
    checks = await runRecordedChecks(store, { purpose: 'base', sha }, config.checks, dir, log);
  }
  if (checks.status === 'passed') {
    await store.setStatus({ role: 'gate', state: 'done', detail: `Checks pass on ${sha.slice(0, 10)}` });
    return { sha, dir, checks };
  }
  const failed = checks.results.find((r) => !r.ok)?.name ?? 'a check';
  const blocked = `The check ${failed} fails on ${sha.slice(0, 10)}: without a green oracle no refactor can be verified.`;
  await store.setStatus({ role: 'gate', state: 'failed', detail: blocked });
  return { sha, dir, checks, blocked };
}

/** Only the checkout of the current commit stays. */
async function pruneCheckouts(source: string, root: string, keep: string): Promise<void> {
  if (!existsSync(root)) return;
  for (const name of await readdir(root)) {
    const dir = join(root, name);
    if (dir !== keep) await removeWorktree(source, dir);
  }
}

/** The census and the role context for work on the base. */
export async function roleContext(
  loaded: LoadedConfig,
  deps: PatrolDeps,
  base: Checkout,
): Promise<{ ctx: RoleContext; census: Census }> {
  const census = await takeCensus(base.dir, loaded.config);
  const playbook = await playbookFor(census.stack);
  // The rules come from the base checkout, which every role reads and no agent edits.
  const rules = (near: string[]) => readRepoRules(base.dir, loaded.dir, near);
  return { census, ctx: { loaded, store: deps.store, runtimeFor: deps.runtimeFor, playbook, rules, log: deps.log } };
}
