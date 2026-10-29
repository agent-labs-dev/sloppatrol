/** A guard is a rule on the diff itself, decided by code. */
export type GuardFinding = { guard: string; file?: string; detail: string };

/** A check is one of the repo's own commands: typecheck, lint, test, build. */
export type CheckResult = {
  name: string;
  command: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  /** The end of the output, for a person or an agent to read. */
  output: string;
};

/**
 * One run of the repo's checks, saved after each check so a person can
 * follow it live. `base` runs on the patrolled commit, `gate` judges a
 * refactor, `refactorer` is the refactorer trying its own change, and
 * `mutation` runs the tests against a planted bug, which they must catch.
 */
export type CheckRun = {
  id: string;
  purpose: 'base' | 'gate' | 'refactorer' | 'mutation';
  sha: string;
  refactorId?: string;
  branch?: string;
  status: 'running' | 'passed' | 'failed';
  /** Which commands ran: a run of other commands proves nothing about these. */
  checksKey: string;
  /** The check that runs now. */
  current?: string;
  results: CheckResult[];
  startedAt: string;
  finishedAt?: string;
};
