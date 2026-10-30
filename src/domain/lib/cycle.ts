import type { Refactor } from './refactor.js';

/** What one patrol cycle did, saved when it ends, so a person can see the result of each run. */
export type Cycle = {
  id: string;
  /** The patrolled commit. Absent when the cycle stopped before it resolved one. */
  sha?: string;
  startedAt: string;
  finishedAt: string;
  /** Why the cycle did no work: the checks fail on the patrolled commit. */
  blocked?: string;
  /** The cycle stopped with an error. */
  error?: string;
  /** Opportunities the surveyor recorded. */
  surveyed: number;
  refactors: Pick<Refactor, 'id' | 'status'>[];
  published: number;
};
