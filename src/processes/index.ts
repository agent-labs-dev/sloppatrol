import { type ChildProcess, execFileSync } from 'node:child_process';
import { getPriority, setPriority } from 'node:os';

/**
 * Every process group Sloppatrol starts: checks and agent CLIs. Each runs
 * detached, in its own group, so a timeout can stop its whole tree; the
 * same is true when Sloppatrol itself stops, so the CLI calls `stopAll`.
 */
const running = new Set<ChildProcess>();

export function track(child: ChildProcess): void {
  running.add(child);
  child.once('exit', () => running.delete(child));
}

export function stopGroup(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  try {
    if (child.pid) process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

export function stopAll(): void {
  for (const child of running) stopGroup(child, 'SIGKILL');
  running.clear();
}

/**
 * Lowers Sloppatrol's own CPU priority to `nice`, and on Linux its I/O
 * priority to the lowest best-effort level. Every check and agent CLI it
 * starts inherits both, so a patrol yields to the developer's own work.
 * `nice: 0` leaves both as they are.
 */
export function lowerPriority(nice: number, log: (line: string) => void): void {
  if (nice <= 0) return;
  try {
    setPriority(Math.max(getPriority(), nice));
  } catch (error) {
    log(`sloppatrol: cannot lower the CPU priority: ${(error as Error).message}`);
  }
  if (process.platform !== 'linux') return;
  try {
    execFileSync('ionice', ['-c', '2', '-n', '7', '-p', String(process.pid)], { stdio: 'ignore' });
  } catch {
    log('sloppatrol: ionice is not available, so the I/O priority stays as it is.');
  }
}
