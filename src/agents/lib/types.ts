import type { AgentEvent } from '../../domain/index.js';

/**
 * A tool is the contract between a role and its runtime (ADR 0003). The
 * model loop calls `run` in-process; the CLI runtime serves the same tool
 * over MCP. So a role behaves the same whatever runs it.
 */
export type ToolResult = {
  text: string;
  isError?: boolean;
  /** Set by the finishing tool: the runtime stops after this result. */
  done?: boolean;
  /** One sentence for the activity log. The text is written for the model. */
  summary?: string;
};

export type Tool = {
  name: string;
  description: string;
  /** JSON Schema for the input object. */
  inputSchema: Record<string, unknown>;
  run(input: Record<string, unknown>): Promise<ToolResult>;
};

export type RoleTask = {
  system: string;
  prompt: string;
  tools: Tool[];
  maxSteps: number;
  budgetUsd?: number;
  timeoutMs: number;
  /** The agent's working directory: a checkout, or a refactor's worktree. */
  workdir: string;
};

export type RoleOutcome = {
  stop: 'done' | 'max-steps' | 'budget' | 'timeout' | 'error';
  steps: number;
  costUsd: number;
  /** The finishing tool's text, or the agent's last text. */
  summary?: string;
  finished: boolean;
  error?: string;
};

export type EventSink = (event: Omit<AgentEvent, 'at' | 'sessionId' | 'role'>) => void;

/** Runs one role session. A CLI agent and an API model loop both satisfy it. */
export interface Runtime {
  readonly label: string;
  run(task: RoleTask, emit: EventSink): Promise<RoleOutcome>;
}
