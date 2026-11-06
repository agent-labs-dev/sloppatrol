import { existsSync } from 'node:fs';
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
  AgentEvent,
  AgentStatus,
  CheckRun,
  Cycle,
  Opportunity,
  Refactor,
  Scorecard,
  UnitScores,
} from '../domain/index.js';
import { readJson, readJsonFolder, writeJson } from './lib/json-files.js';

export type PatrolState = {
  lastSha?: string;
  /** The commit the surveyor read last. */
  surveyedSha?: string;
  lastCycleAt?: string;
  cycles: number;
};

/**
 * All Sloppatrol data is plain JSON under `.sloppatrol/runs/`, so a person,
 * an agent and a dashboard can all read it.
 */
export class Store {
  readonly root: string;

  constructor(configDir: string) {
    this.root = join(configDir, 'runs');
  }

  path(...parts: string[]): string {
    return join(this.root, ...parts);
  }

  saveOpportunity(opportunity: Opportunity): Promise<void> {
    return writeJson(this.path('opportunities', `${opportunity.id}.json`), opportunity);
  }
  getOpportunity(id: string): Promise<Opportunity | undefined> {
    return readJson(this.path('opportunities', `${id}.json`));
  }
  listOpportunities(): Promise<Opportunity[]> {
    return readJsonFolder(this.path('opportunities'));
  }

  saveRefactor(refactor: Refactor): Promise<void> {
    return writeJson(this.path('refactors', `${refactor.id}.json`), refactor);
  }
  getRefactor(id: string): Promise<Refactor | undefined> {
    return readJson(this.path('refactors', `${id}.json`));
  }
  listRefactors(): Promise<Refactor[]> {
    return readJsonFolder(this.path('refactors'));
  }

  saveCheckRun(run: CheckRun): Promise<void> {
    return writeJson(this.path('checks', `${run.id}.json`), run);
  }
  listCheckRuns(): Promise<CheckRun[]> {
    return readJsonFolder(this.path('checks'));
  }
  /** The newest finished run of these checks (`checksKey`) on the commit `sha` itself. */
  async baseCheckRun(sha: string, checksKey: string): Promise<CheckRun | undefined> {
    return (await this.listCheckRuns()).findLast(
      (run) => run.purpose === 'base' && run.sha === sha && run.checksKey === checksKey && run.status !== 'running',
    );
  }

  saveCycle(cycle: Cycle): Promise<void> {
    return writeJson(this.path('cycles', `${cycle.id}.json`), cycle);
  }
  /** Oldest first. */
  listCycles(): Promise<Cycle[]> {
    return readJsonFolder(this.path('cycles'));
  }

  /** A file's scores, by the hash of its path, content and rubric: the same file is judged once. */
  saveUnitScores(scores: UnitScores): Promise<void> {
    return writeJson(this.path('scores', `${scores.contentHash}.json`), scores);
  }
  getUnitScores(contentHash: string): Promise<UnitScores | undefined> {
    return readJson(this.path('scores', `${contentHash}.json`));
  }

  saveScorecard(scorecard: Scorecard): Promise<void> {
    return writeJson(this.path('scorecards', `${scorecard.sha}.json`), scorecard);
  }
  getScorecard(sha: string): Promise<Scorecard | undefined> {
    return readJson(this.path('scorecards', `${sha}.json`));
  }
  /** Oldest first. */
  async listScorecards(): Promise<Scorecard[]> {
    return (await readJsonFolder<Scorecard>(this.path('scorecards'))).sort((a, b) => a.at.localeCompare(b.at));
  }

  async patrolState(): Promise<PatrolState> {
    return (await readJson<PatrolState>(this.path('patrol.json'))) ?? { cycles: 0 };
  }
  savePatrolState(state: PatrolState): Promise<void> {
    return writeJson(this.path('patrol.json'), state);
  }

  async appendEvent(event: AgentEvent): Promise<void> {
    const file = this.path('sessions', event.sessionId, 'events.jsonl');
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(event)}\n`);
  }

  async events(sessionId: string): Promise<AgentEvent[]> {
    const file = this.path('sessions', sessionId, 'events.jsonl');
    if (!existsSync(file)) return [];
    const lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    return lines.map((line) => JSON.parse(line) as AgentEvent);
  }

  /** Session ids, oldest first. */
  async sessions(): Promise<string[]> {
    const dir = this.path('sessions');
    return existsSync(dir) ? (await readdir(dir)).sort() : [];
  }

  async statuses(): Promise<AgentStatus[]> {
    return Object.values((await readJson<Record<string, AgentStatus>>(this.path('agents.json'))) ?? {});
  }

  async setStatus(status: Omit<AgentStatus, 'pid' | 'updatedAt'>): Promise<void> {
    const file = this.path('agents.json');
    const map = (await readJson<Record<string, AgentStatus>>(file)) ?? {};
    map[status.role] = { ...status, pid: process.pid, updatedAt: new Date().toISOString() };
    await writeJson(file, map);
  }
}
