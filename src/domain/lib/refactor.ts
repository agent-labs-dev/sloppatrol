import type { CheckResult, GuardFinding } from './checks.js';
import type { Proof } from './proof.js';

/**
 * - working: the refactorer edits its worktree.
 * - verified: the gate passed; the branch waits for publication.
 * - rejected: the gate failed. The worktree is gone.
 * - failed: the refactorer or Sloppatrol stopped with an error.
 * - published: a pull request is open.
 * - merged / closed: what GitHub says happened to the pull request.
 */
type RefactorStatus = 'working' | 'verified' | 'rejected' | 'failed' | 'published' | 'merged' | 'closed';

/** One attempt at one opportunity, in its own worktree and branch. */
export type Refactor = {
  id: string;
  opportunityId: string;
  status: RefactorStatus;
  branch: string;
  worktree: string;
  baseSha: string;
  headSha?: string;
  summary?: string;
  verdict?: GateVerdict;
  /** The evidence: what the change improved, and that it broke nothing. */
  proof?: Proof;
  diffStat?: { files: number; added: number; removed: number };
  prUrl?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
};

/** The reviewer can only veto (ADR 0001). */
export type Review = {
  approve: boolean;
  reasons: string;
  /** Which of the repo's own rules apply to the change, and how it respects each. */
  rules: string;
};

export type GateVerdict = {
  passed: boolean;
  guards: GuardFinding[];
  checks: CheckResult[];
  /** The recorded run behind `checks`. */
  checkRunId?: string;
  review?: Review;
};
