import { createHash } from 'node:crypto';
import { type CheckRun, newId } from '../../domain/index.js';
import type { Store } from '../../store/index.js';
import { type Command, runChecks } from './checks.js';

export type CheckTarget = Pick<CheckRun, 'purpose' | 'sha' | 'refactorId' | 'branch'>;

/** Names the exact commands, so a config change never reuses an old result. */
export function checksKey(checks: Command[]): string {
  const text = JSON.stringify(checks.map((c) => [c.name, c.run]));
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** Runs the checks and saves the run after each check, so it can be followed live. */
export async function runRecordedChecks(
  store: Store,
  target: CheckTarget,
  checks: Command[],
  dir: string,
  log?: (line: string) => void,
): Promise<CheckRun> {
  let run: CheckRun = {
    id: newId(),
    ...target,
    status: 'running',
    checksKey: checksKey(checks),
    results: [],
    startedAt: new Date().toISOString(),
  };
  let saves = Promise.resolve();
  const save = (patch: Partial<CheckRun>) => {
    run = { ...run, ...patch };
    const snapshot = run;
    saves = saves.then(() => store.saveCheckRun(snapshot));
  };
  save({ current: checks[0]?.name });
  const results = await runChecks(checks, dir, log, (result, next) =>
    save({ results: [...run.results, result], current: next }),
  );
  const passed = results.length === checks.length && results.every((r) => r.ok);
  save({ status: passed ? 'passed' : 'failed', current: undefined, finishedAt: new Date().toISOString() });
  await saves;
  return run;
}
