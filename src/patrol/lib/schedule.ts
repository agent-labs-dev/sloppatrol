import { availableParallelism, loadavg } from 'node:os';
import type { SloppatrolConfig } from '../../config/index.js';
import type { CycleResult } from './cycle.js';

type PatrolSettings = SloppatrolConfig['patrol'];
const DAY_MS = 24 * 60 * 60_000;

/** A cycle that surveyed, attempted and published nothing, or that failed. */
export function isIdle(result: CycleResult | undefined): boolean {
  return !result || (result.surveyed === 0 && result.refactors.length === 0 && result.published.length === 0);
}

/** Minutes to the next cycle: the interval, doubled for each idle cycle in a row, up to `maxIntervalMinutes`. */
export function waitMinutes(patrol: PatrolSettings, idleStreak: number): number {
  if (!patrol.backoff) return patrol.intervalMinutes;
  return Math.min(
    patrol.intervalMinutes * 2 ** idleStreak,
    Math.max(patrol.intervalMinutes, patrol.maxIntervalMinutes),
  );
}

/**
 * Why the next cycle must wait, and for how long: the machine is busy (the
 * 1-minute load average is above `maxLoad`, the CPU count by default), or
 * `maxCyclesPerDay` cycles started in the last 24 hours. Undefined when it may run.
 */
export function deferral(
  patrol: PatrolSettings,
  cycleStarts: string[],
  now = Date.now(),
  load = loadavg()[0]!,
  cpus = availableParallelism(),
): { reason: string; minutes: number } | undefined {
  const maxLoad = patrol.maxLoad ?? cpus;
  if (maxLoad > 0 && load > maxLoad)
    return {
      reason: `the machine is busy (load ${load.toFixed(1)} > ${maxLoad})`,
      minutes: patrol.intervalMinutes,
    };
  if (patrol.maxCyclesPerDay === 0) return undefined;
  const today = cycleStarts
    .map((at) => Date.parse(at))
    .filter((at) => now - at < DAY_MS)
    .sort((a, b) => a - b);
  if (today.length < patrol.maxCyclesPerDay) return undefined;
  const freed = today[today.length - patrol.maxCyclesPerDay]! + DAY_MS;
  return {
    reason: `${today.length} cycles ran in the last 24 hours (maxCyclesPerDay ${patrol.maxCyclesPerDay})`,
    minutes: Math.max(1, Math.ceil((freed - now) / 60_000)),
  };
}
