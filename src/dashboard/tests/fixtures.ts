import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AgentEvent,
  AgentStatus,
  CheckResult,
  CheckRun,
  MetricId,
  Opportunity,
  OpportunityKind,
  Refactor,
  Scorecard,
  Strength,
  UnitScores,
} from '../../domain/index.js';
import { sideOf } from '../../domain/index.js';
import { Store } from '../../store/index.js';

/**
 * Demo data for the dashboard, in four shapes: a project with no run, a
 * project after its first cycle, a busy project after two weeks, and a
 * project whose checks fail on main. The data is generic: a small shop app.
 */
export type FixtureShape = 'empty' | 'first-run' | 'busy' | 'blocked';
export const FIXTURE_SHAPES: FixtureShape[] = ['empty', 'first-run', 'busy', 'blocked'];

const config = (github: boolean) => `project: { name: storefront }
checks:
  - name: typecheck
    run: pnpm typecheck
  - name: lint
    run: pnpm lint
  - name: test
    run: pnpm test
    tests: true
github: { enabled: ${github} }
patrol: { pull: main }
`;

const CHECKS_KEY = 'typecheck|lint|test';
const RUBRIC = '4f1c2a9e07';
/** A process that is always alive, so a fixture can show live work. */
const LIVE_PID = 1;
/** A process id that no process has. */
const DEAD_PID = 999_999;

type Clock = { at(minutesAgo: number): string; id(minutesAgo: number): string };

function clock(now: Date): Clock {
  const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();
  let n = 0;
  return {
    at,
    // Sortable by time like `newId`, and unique.
    id: (minutesAgo) =>
      `${at(minutesAgo).replace(/[-:.]/g, '').replace(/Z$/, '')}-${(n++).toString(16).padStart(4, '0')}`,
  };
}

/** A small deterministic random source, so each fixture is the same each time. */
function random(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1_103_515_245 + 12_345) % 2_147_483_648;
    return s / 2_147_483_648;
  };
}

function sha(n: number): string {
  return (n * 2_654_435_761).toString(16).padStart(8, '0').repeat(5).slice(0, 40);
}

const SOURCE_FILES = [
  ['src/cart/checkout.ts', 412],
  ['src/cart/pricing.ts', 233],
  ['src/cart/discounts.ts', 187],
  ['src/orders/order-service.ts', 538],
  ['src/orders/refunds.ts', 164],
  ['src/payments/gateway.ts', 301],
  ['src/payments/card-adapter.ts', 142],
  ['src/inventory/stock.ts', 276],
  ['src/users/session.ts', 129],
  ['src/users/profile.ts', 98],
  ['src/shipping/rates.ts', 214],
  ['src/shipping/labels.ts', 121],
  ['src/api/routes.ts', 367],
  ['src/api/middleware.ts', 88],
  ['src/lib/money.ts', 64],
  ['src/lib/dates.ts', 57],
  ['src/lib/http.ts', 112],
  ['src/db/repository.ts', 245],
  ['src/search/index.ts', 191],
  ['src/notify/email.ts', 133],
] as const;
const TEST_FILES = [
  ['test/cart.test.ts', 286],
  ['test/orders.test.ts', 341],
  ['test/payments.test.ts', 198],
  ['test/shipping.test.ts', 122],
  ['test/users.test.ts', 87],
] as const;
const SOURCE_METRICS: MetricId[] = ['simplicity', 'modularity', 'injection', 'purity', 'clarity', 'guardrails'];
const TEST_METRICS: MetricId[] = ['simplicity', 'tests', 'clarity', 'guardrails'];

const EVIDENCE: Record<MetricId, string> = {
  simplicity: 'Lines 40-118: one function holds four nested branches for the discount rules.',
  modularity: 'The module exports 14 functions; callers reach into its helpers (lines 12-30).',
  injection: 'Line 9 creates the database client inside the function, so a test cannot replace it.',
  purity: 'Lines 55-71 read the clock and write the log in the middle of the price calculation.',
  tests: 'The tests mock the repository (lines 4-20) and assert on calls, not on results.',
  clarity: 'The names `tmp2` and `doIt` (lines 88, 102) hide what the code does.',
  guardrails: 'The file has types on each export and no suppression.',
};

/** The scores of the shop's files: `lift` raises them, as refactors land. */
function units(rand: () => number, count: number, lift: number): UnitScores[] {
  const files = [
    ...SOURCE_FILES.map(([path, lines]) => ({ path, lines, test: false })),
    ...TEST_FILES.map(([path, lines]) => ({ path, lines, test: true })),
  ].slice(0, count);
  return files.map(({ path, lines, test }) => {
    const scores: UnitScores['scores'] = {};
    for (const metric of test ? TEST_METRICS : SOURCE_METRICS) {
      const level = Math.max(0, Math.min(4, Math.round(1 + rand() * 2.6 + lift)));
      scores[metric] = { score: level, evidence: EVIDENCE[metric] };
    }
    return {
      path,
      contentHash: `${path.replace(/\W/g, '').slice(-12)}${Math.round(lift * 10)}`.padEnd(20, '0').slice(0, 20),
      rubric: RUBRIC,
      signals: {
        lines,
        maxNesting: 2 + Math.floor(rand() * 4),
        commentLines: Math.floor(lines * 0.06),
        mocks: test ? Math.floor(rand() * 6) : 0,
        suppressions: Math.floor(rand() * 2),
      },
      scores,
    };
  });
}

function means(list: UnitScores[]): Scorecard['means'] {
  const out: Scorecard['means'] = {};
  for (const metric of [...SOURCE_METRICS, 'tests'] as MetricId[]) {
    let total = 0;
    let weight = 0;
    for (const unit of list) {
      const score = unit.scores[metric];
      if (!score) continue;
      total += score.score * unit.signals.lines;
      weight += unit.signals.lines;
    }
    if (weight) out[metric] = Math.round((total / weight) * 100) / 100;
  }
  return out;
}

const GUARDRAILS: Scorecard['guardrails'] = [
  { name: 'Agent guide', present: true, evidence: 'AGENTS.md' },
  { name: 'Strict types', present: true, evidence: 'tsconfig.json: strict' },
  { name: 'Linter', present: true, evidence: 'biome.json' },
  { name: 'Module boundaries', present: false, evidence: 'Nothing stops a deep import across modules.' },
  { name: 'Pre-commit hook', present: false, evidence: 'No hook: a broken change reaches a commit.' },
  { name: 'CI', present: true, evidence: '.github/workflows/ci.yml' },
  { name: 'Tests', present: true, evidence: '41 test files' },
];

function scorecard(input: { sha: string; at: string; list: UnitScores[] }): Scorecard {
  const lines = input.list.reduce((sum, u) => sum + u.signals.lines, 0);
  return {
    sha: input.sha,
    at: input.at,
    rubric: RUBRIC,
    units: input.list,
    means: means(input.list),
    coverage: { files: input.list.length, totalFiles: 148, lines, totalLines: 18_420 },
    guardrails: GUARDRAILS,
  };
}

function result(name: string, ok: boolean, durationMs: number, output = ''): CheckResult {
  const command = { typecheck: 'pnpm typecheck', lint: 'pnpm lint', test: 'pnpm test' }[name] ?? name;
  return { name, command, ok, exitCode: ok ? 0 : 1, durationMs, output: ok ? '' : output };
}

const TEST_OUTPUT_PASS = (n: number) => `# tests ${n}\n# pass ${n}\n# fail 0\n`;
const TEST_FAILURE = `not ok 14 - checkout applies the member discount before tax
  ---
  expected: 81.9
  actual: 91
  at: test/cart.test.ts:88:5
  ...
# tests 212
# pass 211
# fail 1`;
const TYPE_FAILURE = `src/orders/order-service.ts(212,7): error TS2322: Type 'string | undefined' is not assignable to type 'string'.
src/orders/order-service.ts(240,15): error TS2345: Argument of type 'Order | null' is not assignable to parameter of type 'Order'.`;

function checkRun(
  c: Clock,
  input: {
    minutesAgo: number;
    purpose: CheckRun['purpose'];
    sha: string;
    fail?: 'typecheck' | 'lint' | 'test';
    tests?: number;
    refactorId?: string;
    branch?: string;
    running?: boolean;
  },
): CheckRun {
  const results: CheckResult[] = [];
  let elapsed = 0;
  const names = input.purpose === 'mutation' ? ['test'] : ['typecheck', 'lint', 'test'];
  for (const name of names) {
    const durationMs = { typecheck: 8_400, lint: 3_100, test: 46_200 }[name]!;
    if (input.running && name === 'test') break;
    const ok = input.fail !== name;
    const output = name === 'test' ? TEST_FAILURE : TYPE_FAILURE;
    results.push({
      ...result(name, ok, durationMs, output),
      ...(ok && name === 'test' ? { output: TEST_OUTPUT_PASS(input.tests ?? 212) } : {}),
    });
    elapsed += durationMs;
    if (!ok) break;
  }
  const failed = results.some((r) => !r.ok);
  return {
    id: c.id(input.minutesAgo),
    purpose: input.purpose,
    sha: input.sha,
    ...(input.refactorId ? { refactorId: input.refactorId } : {}),
    ...(input.branch ? { branch: input.branch } : {}),
    status: input.running ? 'running' : failed ? 'failed' : 'passed',
    checksKey: CHECKS_KEY,
    ...(input.running ? { current: 'test' } : {}),
    results,
    startedAt: c.at(input.minutesAgo),
    ...(input.running ? {} : { finishedAt: new Date(Date.parse(c.at(input.minutesAgo)) + elapsed).toISOString() }),
  };
}

type Idea = {
  kind: OpportunityKind;
  title: string;
  files: string[];
  strength: Strength;
  metrics: MetricId[];
};

const IDEAS: Idea[] = [
  {
    kind: 'split-module',
    title: 'Split the order service into placement, payment and fulfilment',
    files: ['src/orders/order-service.ts'],
    strength: 'strong',
    metrics: ['modularity', 'simplicity'],
  },
  {
    kind: 'inject-dependency',
    title: 'Pass the database client into the stock module',
    files: ['src/inventory/stock.ts'],
    strength: 'strong',
    metrics: ['injection'],
  },
  {
    kind: 'replace-mock',
    title: 'Test the cart against an in-memory repository, not a mock',
    files: ['test/cart.test.ts'],
    strength: 'strong',
    metrics: ['tests'],
  },
  {
    kind: 'simplify',
    title: 'Flatten the discount rules into one table',
    files: ['src/cart/discounts.ts'],
    strength: 'worth-exploring',
    metrics: ['simplicity', 'clarity'],
  },
  {
    kind: 'separate-concerns',
    title: 'Move the clock and the log out of the price calculation',
    files: ['src/cart/pricing.ts'],
    strength: 'strong',
    metrics: ['purity'],
  },
  {
    kind: 'characterize',
    title: 'Pin the refund rules with tests before a change',
    files: ['test/orders.test.ts'],
    strength: 'worth-exploring',
    metrics: ['tests'],
  },
  {
    kind: 'remove-dead-code',
    title: 'Remove the unused legacy label printer',
    files: ['src/shipping/labels.ts'],
    strength: 'strong',
    metrics: ['simplicity'],
  },
  {
    kind: 'tighten-types',
    title: 'Replace the loose order status strings with a union',
    files: ['src/orders/order-service.ts', 'src/orders/refunds.ts'],
    strength: 'worth-exploring',
    metrics: ['guardrails', 'clarity'],
  },
  {
    kind: 'extract-interface',
    title: 'Put the card adapter behind a payment port',
    files: ['src/payments/gateway.ts', 'src/payments/card-adapter.ts'],
    strength: 'worth-exploring',
    metrics: ['modularity', 'injection'],
  },
  {
    kind: 'rename',
    title: 'Rename the vague helpers in the HTTP module',
    files: ['src/lib/http.ts'],
    strength: 'speculative',
    metrics: ['clarity'],
  },
  {
    kind: 'dedupe',
    title: 'Use one money formatter in email and checkout',
    files: ['src/notify/email.ts', 'src/cart/checkout.ts'],
    strength: 'worth-exploring',
    metrics: ['simplicity'],
  },
  {
    kind: 'deepen-module',
    title: 'Hide the search index details behind one query function',
    files: ['src/search/index.ts'],
    strength: 'speculative',
    metrics: ['modularity'],
  },
  {
    kind: 'test-through-interface',
    title: 'Test payments through the gateway, not its private helpers',
    files: ['test/payments.test.ts'],
    strength: 'strong',
    metrics: ['tests'],
  },
  {
    kind: 'inject-dependency',
    title: 'Pass the mailer into the email module',
    files: ['src/notify/email.ts'],
    strength: 'worth-exploring',
    metrics: ['injection', 'purity'],
  },
  {
    kind: 'simplify',
    title: 'Replace the nested rate lookups with a map',
    files: ['src/shipping/rates.ts'],
    strength: 'worth-exploring',
    metrics: ['simplicity'],
  },
  {
    kind: 'separate-concerns',
    title: 'Move request parsing out of the route handlers',
    files: ['src/api/routes.ts'],
    strength: 'strong',
    metrics: ['purity', 'modularity'],
  },
  {
    kind: 'split-module',
    title: 'Split the repository into one file per table',
    files: ['src/db/repository.ts'],
    strength: 'speculative',
    metrics: ['modularity'],
  },
  {
    kind: 'replace-mock',
    title: 'Test the session with a fake store, not a mock',
    files: ['test/users.test.ts'],
    strength: 'worth-exploring',
    metrics: ['tests'],
  },
  {
    kind: 'simplify',
    title: 'Use the platform date functions in the dates helper',
    files: ['src/lib/dates.ts'],
    strength: 'speculative',
    metrics: ['simplicity'],
  },
  {
    kind: 'tighten-types',
    title: 'Type the middleware context',
    files: ['src/api/middleware.ts', 'src/api/routes.ts'],
    strength: 'worth-exploring',
    metrics: ['guardrails'],
  },
];

function opportunity(c: Clock, idea: Idea, minutesAgo: number, foundAt: string): Opportunity {
  const side = sideOf(idea.kind);
  return {
    id: c.id(minutesAgo),
    fingerprint: idea.title.replace(/\W/g, '').slice(0, 16).toLowerCase(),
    kind: idea.kind,
    side,
    title: idea.title,
    files: idea.files,
    problem: `${idea.files[0]} mixes several jobs, so a small change touches code that has no relation to it, and the tests must set up all of it.`,
    change: `${idea.title}. Keep each public function and its behaviour; move the code, then update the imports.`,
    benefits: 'A change stays local, and a test needs less setup.',
    metrics: idea.metrics,
    strength: idea.strength,
    status: 'open',
    attempts: 0,
    foundAt,
    createdAt: c.at(minutesAgo),
    updatedAt: c.at(minutesAgo),
  };
}

function events(
  c: Clock,
  input: {
    minutesAgo: number;
    role: AgentEvent['role'];
    subject: string;
    end: 'finish' | 'error' | 'none' | 'interrupted';
    costUsd: number;
  },
): AgentEvent[] {
  const sessionId = `${c.id(input.minutesAgo)}-${input.role}`;
  const base = { sessionId, role: input.role, subject: input.subject };
  const steps: AgentEvent[] = [
    { ...base, at: c.at(input.minutesAgo), kind: 'start', summary: `${input.role} started on claude.` },
    { ...base, at: c.at(input.minutesAgo - 0.2), kind: 'thought', summary: 'I read the files and the playbook first.' },
    {
      ...base,
      at: c.at(input.minutesAgo - 0.4),
      kind: 'tool-call',
      tool: 'read_file',
      summary: 'read_file',
      input: { path: 'src/cart/checkout.ts' },
    },
    { ...base, at: c.at(input.minutesAgo - 0.5), kind: 'tool-result', tool: 'read_file', summary: '412 lines' },
    { ...base, at: c.at(input.minutesAgo - 1.2), kind: 'tool-call', tool: 'run_checks', summary: 'run_checks' },
    {
      ...base,
      at: c.at(input.minutesAgo - 2.4),
      kind: 'tool-result',
      tool: 'run_checks',
      summary: 'typecheck ok, lint ok, test ok',
    },
  ];
  if (input.end === 'finish')
    steps.push({
      ...base,
      at: c.at(input.minutesAgo - 3),
      kind: 'finish',
      summary: 'Finished (done): the change is ready.',
      costUsd: input.costUsd,
    });
  if (input.end === 'error')
    steps.push({
      ...base,
      at: c.at(input.minutesAgo - 3),
      kind: 'error',
      summary: 'Stopped: the agent CLI exited with code 1.',
      costUsd: input.costUsd,
    });
  if (input.end === 'interrupted')
    steps.push({ ...base, at: c.at(input.minutesAgo - 3), kind: 'error', summary: 'Interrupted: Sloppatrol stopped.' });
  return steps;
}

async function saveEvents(store: Store, list: AgentEvent[]): Promise<string> {
  for (const event of list) await store.appendEvent(event);
  return list[0]!.sessionId;
}

/** `agents.json` as the patrol writes it, with a chosen process id. */
function writeStatuses(store: Store, statuses: Omit<AgentStatus, 'updatedAt'>[], at: string): void {
  mkdirSync(store.root, { recursive: true });
  const map = Object.fromEntries(statuses.map((s) => [s.role, { ...s, updatedAt: at }]));
  writeFileSync(store.path('agents.json'), `${JSON.stringify(map, null, 2)}\n`);
}

/** Writes `<root>/.sloppatrol/` with the data of one shape. Returns the store. */
export async function writeFixture(root: string, shape: FixtureShape, now = new Date()): Promise<Store> {
  const dir = join(root, '.sloppatrol');
  mkdirSync(dir, { recursive: true });
  // Only the busy project opens pull requests: the first run keeps its refactor for `publish`.
  writeFileSync(join(dir, 'sloppatrol.yml'), config(shape === 'busy'));
  const store = new Store(dir);
  if (shape === 'empty') return store;
  const c = clock(now);
  if (shape === 'first-run') await firstRun(store, c);
  if (shape === 'busy') await busy(store, c);
  if (shape === 'blocked') await blocked(store, c);
  return store;
}

async function firstRun(store: Store, c: Clock): Promise<void> {
  const main = sha(1);
  const rand = random(7);
  await store.saveCheckRun(checkRun(c, { minutesAgo: 52, purpose: 'base', sha: main }));
  const list = units(rand, 14, 0);
  for (const unit of list) await store.saveUnitScores(unit);
  await store.saveScorecard(scorecard({ sha: main, at: c.at(46), list }));
  await saveEvents(
    store,
    events(c, { minutesAgo: 50, role: 'assessor', subject: `score:${main}`, end: 'finish', costUsd: 0.41 }),
  );
  await saveEvents(
    store,
    events(c, { minutesAgo: 44, role: 'surveyor', subject: `survey:${main}`, end: 'finish', costUsd: 0.63 }),
  );
  const found = IDEAS.slice(0, 6).map((idea, i) => opportunity(c, idea, 40 - i * 0.1, main));
  const first = found[0]!;
  const r = c.id(38);
  const branch = 'sloppatrol/split-module-split-the-order-service-a1f0';
  await saveEvents(
    store,
    events(c, { minutesAgo: 38, role: 'refactorer', subject: `refactor:${r}`, end: 'finish', costUsd: 1.12 }),
  );
  const gate = checkRun(c, { minutesAgo: 30, purpose: 'gate', sha: main, refactorId: r, branch, tests: 212 });
  await store.saveCheckRun(gate);
  await store.saveRefactor(
    verifiedRefactor(c, { id: r, opportunity: first, branch, baseSha: main, minutesAgo: 22, gateRunId: gate.id }),
  );
  found[0] = { ...first, attempts: 1 };
  for (const o of found) await store.saveOpportunity(o);
  await store.savePatrolState({ lastSha: main, surveyedSha: main, lastCycleAt: c.at(21), cycles: 1 });
  await store.saveCycle({
    id: c.id(53),
    sha: main,
    startedAt: c.at(53),
    finishedAt: c.at(21),
    surveyed: 6,
    refactors: [{ id: r, status: 'verified' }],
    published: 0,
  });
  writeStatuses(
    store,
    [
      { role: 'patrol', state: 'idle', detail: 'Stopped.', pid: DEAD_PID },
      { role: 'gate', state: 'done', detail: `Checks passed on ${branch}`, pid: DEAD_PID },
      { role: 'surveyor', state: 'done', detail: 'Recorded 6 opportunities.', pid: DEAD_PID },
      { role: 'refactorer', state: 'done', detail: 'The order service is now three modules.', pid: DEAD_PID },
      { role: 'assessor', state: 'done', detail: 'Scored 14 files.', pid: DEAD_PID },
      { role: 'reviewer', state: 'done', detail: 'Approved: the change keeps each public function.', pid: DEAD_PID },
    ],
    c.at(21),
  );
}

function verifiedRefactor(
  c: Clock,
  input: {
    id: string;
    opportunity: Opportunity;
    branch: string;
    baseSha: string;
    minutesAgo: number;
    gateRunId: string;
  },
): Refactor {
  const o = input.opportunity;
  return {
    id: input.id,
    opportunityId: o.id,
    status: 'verified',
    branch: input.branch,
    worktree: `.sloppatrol/runs/worktrees/${input.id}`,
    baseSha: input.baseSha,
    headSha: sha(9001),
    summary:
      'Moved placement, payment and fulfilment into three modules. The service keeps its public functions and calls them.',
    verdict: {
      passed: true,
      guards: [],
      checks: [],
      checkRunId: input.gateRunId,
      review: {
        approve: true,
        reasons: 'The change keeps each public function and its tests pass unchanged.',
        rules: 'AGENTS.md: one module per folder. The new modules follow it.',
      },
    },
    proof: {
      behaviour: {
        side: o.side,
        guards: ['one side', 'no frozen file', 'no suppression', 'no test removed', 'within the size limit'],
        testsBase: 212,
        testsHead: 212,
        headRunId: input.gateRunId,
      },
      improvement: {
        rubric: RUBRIC,
        judges: 2,
        targets: o.metrics,
        before: { modularity: 1.5, simplicity: 2 },
        after: { modularity: 3, simplicity: 3 },
        units: [],
        signals: {
          before: { lines: 538, maxNesting: 5, commentLines: 20, mocks: 0, suppressions: 0 },
          after: { lines: 512, maxNesting: 3, commentLines: 24, mocks: 0, suppressions: 0 },
        },
        improved: true,
        reason: 'Modularity and simplicity went up; no metric went down.',
      },
      rules: { sources: ['AGENTS.md'], compliance: 'One module per folder: the new modules follow it.' },
    },
    diffStat: { files: 4, added: 286, removed: 262 },
    createdAt: c.at(input.minutesAgo + 16),
    updatedAt: c.at(input.minutesAgo),
  };
}

type Outcome =
  | 'merged'
  | 'published'
  | 'closed'
  | 'verified'
  | 'guards'
  | 'checks'
  | 'mutation'
  | 'metrics'
  | 'review'
  | 'failed'
  | 'working'
  | 'interrupted';

const REASONS: Partial<Record<Outcome, string>> = {
  guards: 'Changes 14 files; the limit is 8.',
  checks: 'The check test failed.',
  mutation: 'The tests did not catch the planted bug: they cannot fail where it matters.',
  metrics: 'Simplicity did not go up: the new table adds a level of indirection.',
  review: 'The change renames a public function that the API module exports.',
  failed: 'The agent CLI exited with code 1: rate limit.',
  interrupted: 'Interrupted: Sloppatrol stopped.',
};

async function busy(store: Store, c: Clock): Promise<void> {
  const rand = random(42);
  const day = 24 * 60;
  // Twelve commits on main over two weeks, each with a scorecard that covers more files.
  const shas = Array.from({ length: 12 }, (_, i) => sha(100 + i));
  for (const [i, s] of shas.entries()) {
    const minutesAgo = (12 - i) * day + 30;
    await store.saveCheckRun(checkRun(c, { minutesAgo, purpose: 'base', sha: s, tests: 190 + i * 2 }));
    const list = units(random(500), 14 + i, i * 0.08);
    await store.saveScorecard(scorecard({ sha: s, at: c.at(minutesAgo - 20), list }));
    if (i === shas.length - 1) for (const unit of list) await store.saveUnitScores(unit);
  }
  const main = shas.at(-1)!;
  const plan: Outcome[] = [
    'merged',
    'checks',
    'merged',
    'guards',
    'merged',
    'mutation',
    'metrics',
    'merged',
    'closed',
    'failed',
    'merged',
    'review',
    'published',
    'checks',
    'published',
    'verified',
    'interrupted',
    'working',
  ];
  const ideas = IDEAS.map((idea, i) => opportunity(c, idea, 13 * day - i * 600, shas[Math.min(i, 11)]!));
  for (const [i, outcome] of plan.entries()) {
    const minutesAgo = outcome === 'working' ? 6 : Math.round((plan.length - i) * 17 * 60 - rand() * 120);
    const o = ideas[i]!;
    const id = c.id(minutesAgo);
    const branch = `sloppatrol/${o.kind}-${o.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30)}-${id.slice(-4)}`;
    const baseSha = shas[Math.min(11, Math.floor((i / plan.length) * 12))]!;
    const session = await saveEvents(
      store,
      events(c, {
        minutesAgo: minutesAgo + 12,
        role: 'refactorer',
        subject: `refactor:${id}`,
        end:
          outcome === 'working'
            ? 'none'
            : outcome === 'interrupted'
              ? 'interrupted'
              : outcome === 'failed'
                ? 'error'
                : 'finish',
        costUsd: 0.6 + rand() * 1.8,
      }),
    );
    if (outcome === 'working' || outcome === 'interrupted') {
      // The interrupted one, as the next patrol recovers it: failed, with its session ended.
      await store.saveRefactor({
        id,
        opportunityId: o.id,
        status: outcome === 'working' ? 'working' : 'failed',
        branch,
        worktree: `.sloppatrol/runs/worktrees/${id}`,
        baseSha,
        ...(outcome === 'interrupted' ? { reason: REASONS.interrupted } : {}),
        createdAt: c.at(minutesAgo + 12),
        updatedAt: c.at(minutesAgo),
      });
      if (outcome === 'working') {
        await store.saveCheckRun(
          checkRun(c, { minutesAgo: 1, purpose: 'refactorer', sha: baseSha, refactorId: id, branch, running: true }),
        );
        writeLive(store, c, { session, branch, main });
      }
      continue;
    }
    if (outcome === 'failed') {
      await store.saveRefactor({
        id,
        opportunityId: o.id,
        status: 'failed',
        branch,
        worktree: '',
        baseSha,
        reason: REASONS.failed,
        createdAt: c.at(minutesAgo + 12),
        updatedAt: c.at(minutesAgo),
      });
      ideas[i] = { ...o, attempts: 1, reason: REASONS.failed };
      continue;
    }
    if (o.side === 'source' || outcome !== 'guards')
      await store.saveCheckRun(
        checkRun(c, {
          minutesAgo: minutesAgo + 6,
          purpose: 'refactorer',
          sha: baseSha,
          refactorId: id,
          branch,
          fail: i % 3 === 0 ? 'lint' : undefined,
        }),
      );
    const gateFail = outcome === 'checks' ? (i % 2 ? 'test' : 'typecheck') : undefined;
    const gate =
      outcome === 'guards'
        ? undefined
        : checkRun(c, {
            minutesAgo: minutesAgo + 4,
            purpose: 'gate',
            sha: baseSha,
            refactorId: id,
            branch,
            fail: gateFail,
            tests: 200,
          });
    if (gate) await store.saveCheckRun(gate);
    if (o.side === 'tests' && gate?.status === 'passed')
      await store.saveCheckRun(
        checkRun(c, {
          minutesAgo: minutesAgo + 2,
          purpose: 'mutation',
          sha: baseSha,
          refactorId: id,
          branch,
          fail: outcome === 'mutation' ? undefined : 'test',
        }),
      );
    const kept = ['merged', 'published', 'closed', 'verified'].includes(outcome);
    const verified = verifiedRefactor(c, {
      id,
      opportunity: o,
      branch,
      baseSha,
      minutesAgo,
      gateRunId: gate?.id ?? '',
    });
    const status: Refactor['status'] = kept ? (outcome as Refactor['status']) : 'rejected';
    const pr = 40 + i;
    const refactor: Refactor = {
      ...verified,
      status,
      ...(kept ? {} : { reason: REASONS[outcome] }),
      ...(['merged', 'published', 'closed'].includes(outcome)
        ? { prUrl: `https://github.com/example/storefront/pull/${pr}` }
        : {}),
    };
    if (outcome === 'guards') {
      refactor.verdict = { passed: false, guards: [{ guard: 'size', detail: REASONS.guards! }], checks: [] };
      delete refactor.proof;
    }
    if (outcome === 'checks') {
      refactor.verdict = { passed: false, guards: [], checks: gate!.results, checkRunId: gate!.id };
      refactor.proof = { behaviour: { ...verified.proof!.behaviour } };
    }
    if (o.side === 'tests' && refactor.proof && outcome !== 'checks')
      refactor.proof.behaviour.mutation = {
        file: 'src/cart/pricing.ts',
        find: 'sum + item.price * item.qty',
        replace: 'sum + item.price',
        why: 'A total that ignores the quantity must fail a test.',
        caught: outcome !== 'mutation',
      };
    if (outcome === 'metrics' && refactor.proof?.improvement) {
      refactor.proof.improvement = {
        ...refactor.proof.improvement,
        improved: false,
        after: { simplicity: 2, clarity: 2.5 },
        before: { simplicity: 2, clarity: 2 },
        targets: ['simplicity', 'clarity'],
        reason: REASONS.metrics!,
      };
      delete refactor.verdict!.review;
      delete refactor.proof.rules;
    }
    if (outcome === 'mutation' && refactor.proof) {
      delete refactor.proof.improvement;
      delete refactor.verdict!.review;
    }
    if (outcome === 'review')
      refactor.verdict!.review = { approve: false, reasons: REASONS.review!, rules: 'AGENTS.md: keep the public API.' };
    if (!kept) refactor.verdict!.passed = false;
    await store.saveRefactor(refactor);
    const statusOf: Partial<Record<Outcome, Opportunity['status']>> = {
      merged: 'done',
      published: 'proposed',
      closed: 'dismissed',
    };
    ideas[i] = {
      ...o,
      attempts: 1,
      status: statusOf[outcome] ?? (outcome === 'checks' && i > 10 ? 'exhausted' : 'open'),
      ...(outcome === 'closed' ? { reason: 'Its pull request was closed.' } : kept ? {} : { reason: refactor.reason }),
    };
  }
  for (const o of ideas) await store.saveOpportunity(o);
  // Sessions of the other roles, one per cycle.
  for (let i = 0; i < 12; i++) {
    await saveEvents(
      store,
      events(c, {
        minutesAgo: (12 - i) * day + 25,
        role: 'assessor',
        subject: `score:${shas[i]}`,
        end: 'finish',
        costUsd: 0.3 + rand(),
      }),
    );
    if (i % 3 === 0)
      await saveEvents(
        store,
        events(c, {
          minutesAgo: (12 - i) * day + 15,
          role: 'surveyor',
          subject: `survey:${shas[i]}`,
          end: i === 6 ? 'error' : 'finish',
          costUsd: 0.5 + rand(),
        }),
      );
  }
  await store.savePatrolState({ lastSha: main, surveyedSha: main, lastCycleAt: c.at(62), cycles: 41 });
  const refactors = await store.listRefactors();
  for (const [i, s] of shas.entries()) {
    const minutesAgo = (12 - i) * day + 31;
    const end = i === shas.length - 1 ? 62 : minutesAgo - 90;
    const done = refactors.filter((r) => r.baseSha === s && r.status !== 'working');
    await store.saveCycle({
      id: c.id(minutesAgo),
      sha: s,
      startedAt: c.at(minutesAgo),
      finishedAt: c.at(end),
      surveyed: i % 3 === 0 ? 4 : 0,
      refactors: done.map((r) => ({
        id: r.id,
        status: ['merged', 'published', 'closed'].includes(r.status) ? 'verified' : r.status,
      })),
      published: done.filter((r) => r.prUrl).length,
    });
  }
}

function writeLive(store: Store, c: Clock, input: { session: string; branch: string; main: string }): void {
  writeStatuses(
    store,
    [
      { role: 'patrol', state: 'running', detail: 'Cycle 42', pid: LIVE_PID },
      { role: 'gate', state: 'done', detail: `Checks pass on ${input.main.slice(0, 10)}`, pid: LIVE_PID },
      { role: 'surveyor', state: 'done', detail: 'Recorded 4 opportunities.', pid: LIVE_PID },
      {
        role: 'refactorer',
        state: 'running',
        detail: 'Running on claude',
        sessionId: input.session,
        subject: 'refactor',
        pid: LIVE_PID,
      },
      { role: 'assessor', state: 'done', detail: 'Scored 6 more files.', pid: LIVE_PID },
      { role: 'reviewer', state: 'done', detail: 'Rejected: the change renames a public function.', pid: LIVE_PID },
    ],
    c.at(1),
  );
}

async function blocked(store: Store, c: Clock): Promise<void> {
  const good = sha(300);
  const bad = sha(301);
  const rand = random(3);
  await store.saveCheckRun(checkRun(c, { minutesAgo: 3 * 24 * 60, purpose: 'base', sha: good }));
  const list = units(rand, 16, 0.2);
  for (const unit of list) await store.saveUnitScores(unit);
  await store.saveScorecard(scorecard({ sha: good, at: c.at(3 * 24 * 60 - 10), list }));
  const found = IDEAS.slice(4, 12).map((idea, i) => opportunity(c, idea, 3 * 24 * 60 - 20 - i, good));
  for (const o of found) await store.saveOpportunity(o);
  const failing = checkRun(c, { minutesAgo: 8, purpose: 'base', sha: bad, fail: 'test' });
  await store.saveCheckRun(failing);
  await store.savePatrolState({ lastSha: bad, surveyedSha: good, lastCycleAt: c.at(7), cycles: 9 });
  await store.saveCycle({
    id: c.id(9),
    sha: bad,
    startedAt: c.at(9),
    finishedAt: c.at(7),
    blocked: `The check test fails on ${bad.slice(0, 10)}: without a green oracle no refactor can be verified.`,
    surveyed: 0,
    refactors: [],
    published: 0,
  });
  writeStatuses(
    store,
    [
      { role: 'patrol', state: 'idle', detail: 'Next cycle in 60 min', pid: LIVE_PID },
      {
        role: 'gate',
        state: 'failed',
        detail: `The check test fails on ${bad.slice(0, 10)}: without a green oracle no refactor can be verified.`,
        pid: LIVE_PID,
      },
    ],
    c.at(7),
  );
}
