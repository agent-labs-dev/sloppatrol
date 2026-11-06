import { createHash } from 'node:crypto';
import type { MetricId } from './metrics.js';

/**
 * What a refactor does. The kind decides the side: a `tests` kind changes
 * only test files and a `source` kind changes only non-test files, so the
 * other side is always the unchanged oracle (ADR 0002).
 */
export const OPPORTUNITY_KINDS = {
  characterize: 'tests',
  'replace-mock': 'tests',
  'test-through-interface': 'tests',
  'inject-dependency': 'source',
  'extract-interface': 'source',
  'split-module': 'source',
  'deepen-module': 'source',
  'separate-concerns': 'source',
  'remove-dead-code': 'source',
  dedupe: 'source',
  rename: 'source',
  simplify: 'source',
  'tighten-types': 'source',
} as const satisfies Record<string, Side>;

export type OpportunityKind = keyof typeof OPPORTUNITY_KINDS;
export type Side = 'source' | 'tests';
export type Strength = 'strong' | 'worth-exploring' | 'speculative';

export function isOpportunityKind(value: string): value is OpportunityKind {
  return Object.hasOwn(OPPORTUNITY_KINDS, value);
}

export function sideOf(kind: OpportunityKind): Side {
  return OPPORTUNITY_KINDS[kind];
}

/**
 * How a kind proves its gain. `coverage`: a planted bug survives the old
 * tests and the new tests catch it. `metrics`: the target metrics go up.
 */
export function gainOf(kind: OpportunityKind): 'coverage' | 'metrics' {
  return kind === 'characterize' ? 'coverage' : 'metrics';
}

/**
 * - open: waits for a refactorer.
 * - proposed: a verified refactor has an open pull request.
 * - done: its pull request merged.
 * - dismissed: a person closed its pull request, or dismissed it by hand.
 *   Sloppatrol never records the same fingerprint again.
 * - exhausted: every allowed attempt failed the gate.
 */
type OpportunityStatus = 'open' | 'proposed' | 'done' | 'dismissed' | 'exhausted';

/** One improvement the surveyor found. */
export type Opportunity = {
  id: string;
  /** kind + files. One opportunity per fingerprint, ever. */
  fingerprint: string;
  kind: OpportunityKind;
  side: Side;
  title: string;
  files: string[];
  /** Why the current shape causes friction. */
  problem: string;
  /** The change, in plain words. Not a patch. */
  change: string;
  /** What gets better: locality, leverage, testability. */
  benefits: string;
  /** The metrics this refactor must improve (`metrics.ts`). */
  metrics: MetricId[];
  strength: Strength;
  status: OpportunityStatus;
  attempts: number;
  /** The commit the surveyor read. */
  foundAt: string;
  createdAt: string;
  updatedAt: string;
  reason?: string;
};

export function fingerprintOf(kind: OpportunityKind, files: string[]): string {
  const key = `${kind}:${[...files].sort().join('|')}`;
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/**
 * The commit and pull request title. A title that already has a
 * conventional-commit type (`refactor(billing): ...`) keeps it.
 */
export function titleOf(opportunity: Pick<Opportunity, 'side' | 'title'>): string {
  if (/^[a-z]+(\([^)]*\))?!?: /.test(opportunity.title)) return opportunity.title;
  return `${opportunity.side === 'tests' ? 'test' : 'refactor'}: ${opportunity.title}`;
}
