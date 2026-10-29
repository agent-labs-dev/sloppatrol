import type { ChildProcess } from 'node:child_process';

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
