export const AGENT_ROLES = ['surveyor', 'refactorer', 'assessor', 'reviewer'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export type AgentEvent = {
  at: string;
  sessionId: string;
  role: AgentRole;
  /** What the session works on: `survey:<sha>`, `refactor:<id>` or `score:<sha>`. */
  subject?: string;
  kind: 'start' | 'thought' | 'tool-call' | 'tool-result' | 'finish' | 'error';
  summary: string;
  tool?: string;
  input?: unknown;
  output?: string;
  durationMs?: number;
  costUsd?: number;
};

export type AgentStatus = {
  role: AgentRole | 'gate' | 'patrol' | 'publisher';
  state: 'idle' | 'running' | 'done' | 'failed';
  detail: string;
  sessionId?: string;
  subject?: string;
  pid: number;
  updatedAt: string;
};
