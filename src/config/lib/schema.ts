import { z } from 'zod';
import { DEFAULT_TEST_PATTERNS } from '../../globs/index.js';

const CLI_AGENTS = ['claude', 'codex', 'opencode'] as const;
export type CliAgent = (typeof CLI_AGENTS)[number];

/**
 * How a role runs (ADR 0003): a local agent CLI that gets the role's tools
 * over MCP, or Sloppatrol's own loop on an API key.
 */
const runtimeSchema = z.union([
  /** The first agent CLI on PATH: claude, then codex, then opencode. */
  z.literal('auto'),
  z.enum(CLI_AGENTS).transform((agent) => ({ runtime: 'cli' as const, agent })),
  z.object({
    runtime: z.literal('cli'),
    agent: z.enum(CLI_AGENTS).optional(),
    /** Placeholders: {prompt}, {mcp}, {mcpUrl}, {workdir}. */
    command: z.string().optional(),
  }),
  z.object({
    runtime: z.literal('model'),
    via: z.enum(['anthropic', 'openai', 'openrouter', 'custom']),
    model: z.string(),
    endpoint: z.string().optional(),
  }),
]);
export type RoleRuntimeInput = z.infer<typeof runtimeSchema>;

const limits = {
  /** Overrides the top-level `agent` for this role. */
  use: runtimeSchema.optional(),
  maxSteps: z.number().int().positive().default(60),
  timeoutMinutes: z.number().positive().default(30),
  budgetUsd: z.number().positive().optional(),
};

const checkSchema = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, 'lowercase letters, digits, dot, dash and underscore'),
  run: z.string().min(1),
  timeoutMinutes: z.number().positive().default(20),
  /** This check runs tests: the mutation proof of a tests refactor must turn it red. */
  tests: z.boolean().default(false),
});

export const configSchema = z.object({
  version: z.literal(1).default(1),
  project: z.object({ name: z.string().default('app'), source: z.string().default('.') }).default({}),
  /** The runtime of every role, unless a role sets its own `use`. */
  agent: runtimeSchema.default('auto'),
  /** Runs once in each fresh checkout or worktree, before the checks: install, codegen. */
  prepare: z.array(z.string()).default([]),
  /**
   * Mechanical tidy-up commands run in the refactorer's worktree after its
   * session and before the gate: remove the imports and helpers an edit left
   * unused, format, sort. They run on every attempt, so residue from a session
   * that ran out of time never reaches a check. A failing command is logged
   * and left to the checks: cleanup never decides the verdict.
   */
  cleanup: z.array(z.string()).default([]),
  /**
   * The oracle. Each check must pass on the patrolled commit before
   * Sloppatrol starts work, and again on every refactor.
   */
  checks: z.array(checkSchema).min(1, 'add at least one check: the tests'),
  /** Which files are tests. A refactor changes tests or source, never both. */
  tests: z.array(z.string()).default([...DEFAULT_TEST_PATTERNS]),
  /**
   * Test files that no check runs, e.g. an integration tier that needs
   * services. Nothing would prove a change to them, so no refactor may make one.
   */
  uncheckedTests: z.array(z.string()).default([]),
  /** Where the surveyor looks. Empty means the whole repository. */
  focus: z.array(z.string()).default([]),
  /** Files no agent may change: generated code, vendored code, migrations. */
  ignore: z.array(z.string()).default([]),
  guards: z
    .object({
      maxFiles: z.number().int().positive().default(12),
      maxLines: z.number().int().positive().default(600),
    })
    .default({}),
  agents: z
    .object({
      surveyor: z
        .object({
          ...limits,
          enabled: z.boolean().default(true),
          /** Survey again when fewer open opportunities than this remain. */
          minBacklog: z.number().int().nonnegative().default(3),
          /** The most opportunities one survey records. */
          maxPerSurvey: z.number().int().positive().default(8),
        })
        .default({}),
      refactorer: z
        .object({
          ...limits,
          enabled: z.boolean().default(true),
          maxPerCycle: z.number().int().positive().default(1),
          /** Attempts per opportunity before it is exhausted. */
          maxAttempts: z.number().int().positive().default(2),
          /**
           * A session that stops at its timeout hands its worktree to one
           * bounded completion session, which finishes the change and tidies
           * what it left unused instead of letting the gate reject a
           * half-finished edit. These are that session's limits.
           */
          cleanupTimeoutMinutes: z.number().positive().default(15),
          cleanupMaxSteps: z.number().int().positive().default(30),
        })
        .default({}),
      /** Scores files against the metrics rubric, for the scorecard and for each refactor's proof. */
      assessor: z.object({ ...limits }).default({}),
      reviewer: z.object({ ...limits, enabled: z.boolean().default(true) }).default({}),
    })
    .default({}),
  /** The LLM-judged quality metrics (ADR 0004). */
  metrics: z
    .object({
      enabled: z.boolean().default(true),
      /**
       * Files the assessor scores per cycle that have no valid score yet: the
       * most changed first, then the largest. Coverage grows until every file is scored.
       */
      panel: z.number().int().positive().default(100),
      /** How far a metric that is not a target may drop before the refactor is rejected, for judge noise. */
      tolerance: z.number().nonnegative().default(0.5),
      /** Independent assessor sessions per proof, run at once; each score is their mean. */
      judges: z.number().int().positive().default(3),
    })
    .default({}),
  github: z
    .object({
      enabled: z.boolean().default(false),
      repo: z.string().optional(),
      labels: z.array(z.string()).default(['sloppatrol']),
      draft: z.boolean().default(true),
      /** Sloppatrol waits while this many of its pull requests are open. */
      maxOpen: z.number().int().positive().default(3),
    })
    .default({}),
  patrol: z
    .object({
      intervalMinutes: z.number().positive().default(60),
      /** The ref to patrol. A `remote/branch` is fetched first. */
      pull: z.string().default('origin/main'),
    })
    .default({}),
});

export type SloppatrolConfig = z.infer<typeof configSchema>;
export const CLI_AGENT_NAMES: readonly string[] = CLI_AGENTS;
