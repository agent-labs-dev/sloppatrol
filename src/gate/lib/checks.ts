import { spawn } from 'node:child_process';
import type { CheckResult } from '../../domain/index.js';
import { stopGroup, track } from '../../processes/index.js';

export type Command = { name: string; run: string; timeoutMinutes: number };

const TAIL = 4000;

/** Runs one shell command in `dir`; a timeout kills the whole process group. */
export function runCommand(command: Command, dir: string): Promise<CheckResult> {
  const started = Date.now();
  return new Promise((done) => {
    const child = spawn('/bin/sh', ['-c', command.run], {
      cwd: dir,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    track(child);
    let output = '';
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-TAIL * 4);
    };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child, 'SIGKILL');
    }, command.timeoutMinutes * 60_000);
    const finish = (exitCode: number | null) => {
      clearTimeout(timer);
      const tail = output.slice(-TAIL).trim();
      done({
        name: command.name,
        command: command.run,
        ok: exitCode === 0 && !timedOut,
        exitCode,
        durationMs: Date.now() - started,
        output: timedOut ? `${tail}\n(timed out after ${command.timeoutMinutes} min)` : tail,
      });
    };
    child.once('error', (error) => {
      output += String(error);
      finish(null);
    });
    child.once('close', finish);
  });
}

/**
 * Runs the checks in order and stops at the first failure. `onResult` gets
 * each result and the name of the check that runs next.
 */
export async function runChecks(
  checks: Command[],
  dir: string,
  log?: (line: string) => void,
  onResult?: (result: CheckResult, next: string | undefined) => void,
): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const [index, check] of checks.entries()) {
    log?.(`check ${check.name}: ${check.run}`);
    const result = await runCommand(check, dir);
    results.push(result);
    onResult?.(result, result.ok ? checks[index + 1]?.name : undefined);
    log?.(`check ${check.name}: ${result.ok ? 'passed' : 'failed'} in ${(result.durationMs / 1000).toFixed(1)}s`);
    if (!result.ok) break;
  }
  return results;
}
