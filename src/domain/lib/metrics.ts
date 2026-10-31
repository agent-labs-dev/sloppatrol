/**
 * The quality metrics an assessor judges, 0 (worst) to 4 (best), per file.
 * Their rubric lives in the metrics module; the ids are the data contract.
 */
export const METRIC_IDS = [
  'simplicity',
  'modularity',
  'injection',
  'purity',
  'tests',
  'clarity',
  'guardrails',
] as const;
export type MetricId = (typeof METRIC_IDS)[number];

export function isMetricId(value: string): value is MetricId {
  return (METRIC_IDS as readonly string[]).includes(value);
}

export type MetricScore = {
  /** 0-4. A proof's score is the mean of its judges, so it can be fractional. */
  score: number;
  /** The lines that justify the score, cited by number. */
  evidence: string;
};

/** Facts code measures in one file. The assessor reads them as evidence. */
export type Signals = {
  lines: number;
  /** The deepest indentation, in levels. */
  maxNesting: number;
  /** Lines that are only a comment. */
  commentLines: number;
  /** Uses of a mocking library. */
  mocks: number;
  /** Lint and type suppressions. */
  suppressions: number;
};

/** One file's scores against one rubric version. */
export type UnitScores = {
  path: string;
  /** Of the file's content: an unchanged file keeps its scores. */
  contentHash: string;
  rubric: string;
  signals: Signals;
  /** Only the metrics that apply to the file (a source file has no `tests` score). */
  scores: Partial<Record<MetricId, MetricScore>>;
};

/**
 * A repo-wide guardrail (agent guide, strict types, boundaries, ...), found from files.
 * An `informational` one is shown with what was found but neither passes nor fails:
 * whether it helps depends on more than the files can tell.
 */
export type Guardrail = { name: string; present: boolean; evidence: string; informational?: boolean };

/** The repo's scores on one commit: every file with a valid score, and the mean per metric. */
export type Scorecard = {
  sha: string;
  at: string;
  rubric: string;
  units: UnitScores[];
  /** Line-weighted mean per metric over every scored file. */
  means: Partial<Record<MetricId, number>>;
  /** How much of the repo the scores cover: they grow each cycle until every file is scored. */
  coverage: { files: number; totalFiles: number; lines: number; totalLines: number };
  guardrails?: Guardrail[];
};
