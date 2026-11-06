import { describe, expect, it } from 'vitest';
import type { SloppatrolConfig } from '../../config/index.js';
import { deferral, isIdle, waitMinutes } from '../../patrol/index.js';

const PATROL: SloppatrolConfig['patrol'] = {
  intervalMinutes: 60,
  backoff: true,
  maxIntervalMinutes: 24 * 60,
  maxCyclesPerDay: 6,
  pull: 'origin/main',
  nice: 10,
  checks: [],
};
const NOW = Date.parse('2026-11-06T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW - hours * 3_600_000).toISOString();

describe('the patrol schedule', () => {
  it.each([
    [0, true, 60],
    [1, true, 120],
    [3, true, 480],
    [10, true, 1440],
    [3, false, 60],
  ])('after %i idle cycles with backoff %s, waits %i minutes', (streak, backoff, minutes) => {
    expect(waitMinutes({ ...PATROL, backoff }, streak)).toBe(minutes);
  });

  it('counts a failed cycle and one that did nothing as idle', () => {
    expect(isIdle(undefined)).toBe(true);
    expect(isIdle({ sha: 'a', surveyed: 0, refactors: [], published: [] })).toBe(true);
    expect(isIdle({ sha: 'a', surveyed: 2, refactors: [], published: [] })).toBe(false);
  });

  it.each([
    ['runs on an idle machine under the cap', {}, [], 1, undefined],
    ['waits while the load is above the CPU count', {}, [], 9, 60],
    ['waits while the load is above maxLoad', { maxLoad: 2 }, [], 3, 60],
    ['never skips for load with maxLoad 0', { maxLoad: 0 }, [], 99, undefined],
    ['waits for the oldest cycle of the day to age out', {}, [23, 20, 10, 5, 2, 1], 1, 60],
    ['ignores cycles older than a day', {}, [30, 26, 25, 10, 5, 2], 1, undefined],
    ['sets no cap with maxCyclesPerDay 0', { maxCyclesPerDay: 0 }, [6, 5, 4, 3, 2, 1, 0.5], 1, undefined],
  ])('%s', (_, settings: Partial<SloppatrolConfig['patrol']>, ages: number[], load, minutes) => {
    const wait = deferral({ ...PATROL, ...settings }, ages.map(hoursAgo), NOW, load, 8);
    expect(wait?.minutes).toBe(minutes);
  });
});
