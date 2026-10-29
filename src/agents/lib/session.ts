import { type AgentEvent, type AgentRole, newId } from '../../domain/index.js';
import type { Store } from '../../store/index.js';
import type { RoleOutcome, Runtime, Tool } from './types.js';

export type RoleRun = {
  role: AgentRole;
  runtime: Runtime;
  system: string;
  prompt: string;
  tools: Tool[];
  limits: { maxSteps: number; timeoutMinutes: number; budgetUsd?: number };
  workdir: string;
  /** What the session works on, for the dashboard: `survey:<sha>` or `refactor:<id>`. */
  subject?: string;
  store: Store;
  log?: (line: string) => void;
};

/**
 * Runs one role session. Its events go to `sessions/<id>/events.jsonl` and
 * its status to `agents.json`, so a person can follow it live.
 */
export async function runRole(run: RoleRun): Promise<RoleOutcome & { sessionId: string }> {
  const sessionId = `${newId()}-${run.role}`;
  const writes: Promise<void>[] = [];
  const record = (event: Omit<AgentEvent, 'at' | 'sessionId' | 'role'>) => {
    const at = new Date().toISOString();
    writes.push(run.store.appendEvent({ ...event, at, sessionId, role: run.role, subject: run.subject }));
    if (event.kind !== 'tool-result') run.log?.(`[${run.role}] ${event.summary.split('\n')[0]}`);
  };
  await run.store.setStatus({
    role: run.role,
    state: 'running',
    detail: `Running on ${run.runtime.label}`,
    sessionId,
    subject: run.subject,
  });
  record({ kind: 'start', summary: `${run.role} started on ${run.runtime.label}.` });
  let outcome: RoleOutcome;
  try {
    outcome = await run.runtime.run(
      {
        system: run.system,
        prompt: run.prompt,
        tools: run.tools,
        maxSteps: run.limits.maxSteps,
        budgetUsd: run.limits.budgetUsd,
        timeoutMs: run.limits.timeoutMinutes * 60_000,
        workdir: run.workdir,
      },
      record,
    );
  } catch (error) {
    outcome = { stop: 'error', steps: 0, costUsd: 0, finished: false, error: (error as Error).message };
  }
  record({
    kind: outcome.stop === 'error' ? 'error' : 'finish',
    summary: outcome.error
      ? `Stopped: ${outcome.error}`
      : `Finished (${outcome.stop}): ${outcome.summary ?? ''}`.slice(0, 500),
    costUsd: outcome.costUsd,
  });
  await Promise.all(writes);
  await run.store.setStatus({
    role: run.role,
    state: outcome.stop === 'error' ? 'failed' : 'done',
    detail: (outcome.error ?? outcome.summary ?? outcome.stop).split('\n')[0]!.slice(0, 200),
    sessionId,
    subject: run.subject,
  });
  return { ...outcome, sessionId };
}
