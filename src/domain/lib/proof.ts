import type { MetricId, Signals, UnitScores } from './metrics.js';
import type { Side } from './opportunity.js';

/**
 * The evidence for one refactor, built by the gate and shown with the pull
 * request: that it broke nothing, and what it made better.
 */
export type Proof = {
  behaviour: {
    side: Side;
    /** The guards the diff passed. */
    guards: string[];
    /** The check runs on the base commit and on the refactor: the same commands. */
    baseRunId?: string;
    headRunId?: string;
    /** Tests that ran, read from the check output when it says. */
    testsBase?: number;
    testsHead?: number;
    /** A tests refactor: a source change its tests must catch. */
    mutation?: Mutation & {
      caught: boolean;
      runId?: string;
      /** A characterize refactor: whether the old tests on main caught it too. They must not. */
      caughtBefore?: boolean;
      beforeRunId?: string;
    };
  };
  improvement?: Improvement;
  /** The repo's own rules that applied, from the reviewer. */
  rules?: { sources: string[]; compliance: string };
};

/** One small edit to a source file that a correct test suite must catch. */
export type Mutation = { file: string; find: string; replace: string; why: string };

/** The assessor's blind before/after scores of the changed files. */
export type Improvement = {
  rubric: string;
  /** How many independent assessor sessions scored it; each score is their mean. */
  judges: number;
  targets: MetricId[];
  /** Mean per metric over the changed files, before and after. */
  before: Partial<Record<MetricId, number>>;
  after: Partial<Record<MetricId, number>>;
  units: { path: string; before?: UnitScores; after?: UnitScores }[];
  signals: { before: Signals; after: Signals };
  improved: boolean;
  reason: string;
};
