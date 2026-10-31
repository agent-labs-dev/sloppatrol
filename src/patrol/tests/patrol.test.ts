import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../agents/index.js';
import { loadConfig } from '../../config/index.js';
import { fingerprintOf, type Opportunity } from '../../domain/index.js';
import { FakeGitHub } from '../../github/index.js';
import { cycle, openBase, type PatrolDeps, refactorNow, scoreNow, surveyNow } from '../../patrol/index.js';
import { Store } from '../../store/index.js';
import { fixtureRepo, gitIn, read, script } from './fixture.js';

const SIMPLIFY = {
  kind: 'simplify',
  title: 'Compute the total with reduce',
  files: ['src/price.js'],
  problem: 'total() accumulates by hand.',
  change: 'Use reduce.',
  benefits: 'One expression, no mutable sum.',
  metrics: ['simplicity'],
  strength: 'strong',
};

const LOOP = `  let sum = 0;
  for (const item of items) {
    sum = sum + item.price * item.qty;
  }
`;
const REDUCE = '  const sum = items.reduce((acc, item) => acc + item.price * item.qty, 0);\n';

const approve = [
  { tool: 'get_change' },
  { tool: 'approve', input: { reasons: 'Same arithmetic, same rounding.', rules: 'No AGENTS.md in this repo.' } },
];
/** The assessor scores the version with `reduce(` higher: the refactor's own change. */
const reduceIsBetter = [
  { assess: [{ contains: 'reduce(', score: 3 }, { score: 2 }] },
  { tool: 'finish', input: { summary: 'Scored.' } },
];

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  const now = new Date().toISOString();
  return {
    id: `20260101T000000-${Math.random().toString(16).slice(2, 6)}`,
    fingerprint: fingerprintOf('simplify', ['src/price.js']),
    kind: 'simplify',
    side: 'source',
    title: 'Compute the total with reduce',
    files: ['src/price.js'],
    problem: 'p',
    change: 'c',
    benefits: 'b',
    metrics: ['simplicity'],
    strength: 'strong',
    status: 'open',
    attempts: 0,
    foundAt: 'x',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

/**
 * The whole team end to end, with a scripted CLI agent in place of a model:
 * each role reaches Sloppatrol only through its MCP tools, as claude or
 * codex would, and only the gate decides what is kept.
 */
describe('a patrol', () => {
  const repos: string[] = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
  });

  async function setUp(github = true) {
    const repo = fixtureRepo(github);
    repos.push(repo);
    const loaded = await loadConfig(repo);
    const fake = new FakeGitHub();
    const deps: PatrolDeps = { store: new Store(loaded.dir), github: fake, runtimeFor: createRuntime, log: () => {} };
    return { repo, loaded, deps, github: fake };
  }

  it('surveys, refactors, verifies and opens a pull request; a merge finishes the opportunity', async () => {
    const { loaded, deps, github } = await setUp();
    script('surveyor', [
      { tool: 'get_census' },
      { tool: 'record_opportunity', input: { ...SIMPLIFY, kind: 'replace-mock' }, mustSucceed: false },
      { tool: 'record_opportunity', input: SIMPLIFY },
      { tool: 'finish', input: { summary: 'One opportunity.' } },
    ]);
    script('refactorer', [
      { tool: 'get_opportunity' },
      { edit: { file: 'src/price.js', from: LOOP, to: REDUCE } },
      { tool: 'check_guards' },
      { tool: 'run_checks' },
      { tool: 'finish', input: { summary: 'total() now uses reduce.' } },
    ]);
    script('assessor', reduceIsBetter);
    script('reviewer', approve);

    const first = await cycle(loaded, deps);

    expect(first.blocked).toBeUndefined();
    expect(first.surveyed).toBe(1);
    expect(first.refactors.map((r) => r.status)).toEqual(['verified']);
    expect(first.published).toEqual(['https://github.com/fake/repo/pull/1']);
    const pr = github.pullRequests[0]!;
    expect(pr.title).toBe('refactor: Compute the total with reduce');
    expect(pr.body).toContain('total() now uses reduce.');
    expect(pr.body).toContain('Same arithmetic, same rounding.');
    expect(pr.body).toContain('| Simplicity (target) | 50 → 75 (+25) |');
    expect(pr.body).toContain('2 tests passed on main, 2 on this change.');
    const refactored = (await deps.store.listRefactors())[0]!;
    expect(refactored.proof?.improvement).toMatchObject({ improved: true, targets: ['simplicity'] });
    expect(refactored.proof?.rules?.compliance).toBe('No AGENTS.md in this repo.');
    const [scorecard] = await deps.store.listScorecards();
    expect(scorecard?.units.map((u) => u.path).sort()).toEqual(['src/price.js', 'test/price.test.js']);
    expect(scorecard?.means.simplicity).toBe(2);
    expect(gitIn(pr.worktree, 'show', 'HEAD:src/price.js')).toContain('items.reduce(');
    const [recorded] = await deps.store.listOpportunities();
    expect(recorded).toMatchObject({ status: 'proposed', kind: 'simplify', side: 'source' });
    const runs = await deps.store.listCheckRuns();
    expect(runs.map((r) => [r.purpose, r.status])).toEqual([
      ['base', 'passed'],
      ['refactorer', 'passed'],
      ['gate', 'passed'],
    ]);
    expect(await deps.store.listCycles()).toMatchObject([
      { sha: refactored.baseSha, surveyed: 1, refactors: [{ id: refactored.id, status: 'verified' }], published: 1 },
    ]);

    github.setState(pr.url, 'merged');
    script('surveyor', [{ tool: 'finish', input: { summary: 'Nothing new.' } }]);
    await cycle(loaded, deps);
    expect((await deps.store.listOpportunities())[0]?.status).toBe('done');
    expect((await deps.store.listRefactors())[0]?.status).toBe('merged');
  });

  it('rejects a refactor that changes behaviour, because a check fails', async () => {
    const { loaded, deps } = await setUp();
    await deps.store.saveOpportunity(opportunity());
    script('refactorer', [
      { edit: { file: 'src/price.js', from: 'Math.round(sum * 100) / 100', to: 'Math.floor(sum * 100) / 100' } },
      { tool: 'finish', input: { summary: 'Simpler rounding.' } },
    ]);

    const refactor = await refactorNow(loaded, deps);

    expect(refactor.status).toBe('rejected');
    expect(refactor.reason).toBe('The check test failed.');
    expect(refactor.verdict?.checks[0]?.ok).toBe(false);
    expect((await deps.store.listOpportunities())[0]).toMatchObject({ status: 'open', attempts: 1 });
  });

  it('rejects a source refactor that edits a test, before any check runs', async () => {
    const { loaded, deps } = await setUp();
    await deps.store.saveOpportunity(opportunity());
    script('refactorer', [
      { edit: { file: 'src/price.js', from: 'Math.round(sum * 100) / 100', to: 'Math.floor(sum * 100) / 100' } },
      { edit: { file: 'test/price.test.js', from: '21.2);', to: '21.19);' } },
      { tool: 'finish', input: { summary: 'Rounding, and the test to match.' } },
    ]);

    const refactor = await refactorNow(loaded, deps);

    expect(refactor.status).toBe('rejected');
    expect(refactor.verdict?.guards).toEqual([
      { guard: 'one-side', file: 'test/price.test.js', detail: 'A source refactor may not change a test file.' },
    ]);
    expect(refactor.verdict?.checks).toEqual([]);
  });

  it('keeps nothing the reviewer rejects, and exhausts an opportunity after its last attempt', async () => {
    const { loaded, deps } = await setUp();
    await deps.store.saveOpportunity(opportunity({ attempts: 1 }));
    script('refactorer', [
      { edit: { file: 'src/price.js', from: LOOP, to: REDUCE } },
      { tool: 'finish', input: { summary: 'reduce.' } },
    ]);
    script('assessor', reduceIsBetter);
    script('reviewer', [{ tool: 'reject', input: { reasons: 'Not clearer than the loop.', rules: 'None apply.' } }]);

    const refactor = await refactorNow(loaded, deps);

    expect(refactor).toMatchObject({ status: 'rejected', reason: 'Not clearer than the loop.' });
    expect((await deps.store.listOpportunities())[0]).toMatchObject({ status: 'exhausted', attempts: 2 });
    expect(gitIn(loaded.source, 'branch', '--list', 'sloppatrol/*')).toBe('');
  });

  it('does no work while the checks fail on the patrolled commit', async () => {
    const { repo, loaded, deps } = await setUp();
    writeFileSync(
      join(repo, 'test/price.test.js'),
      "import { test } from 'node:test';\ntest('red', () => { throw new Error('red'); });\n",
    );
    gitIn(repo, 'commit', '-q', '-am', 'break the tests');
    script('surveyor', [{ tool: 'finish', input: { summary: 'Should never run.' } }]);

    const result = await cycle(loaded, deps);

    expect(result.blocked).toMatch(/^The check test fails on [0-9a-f]{10}/);
    expect(await deps.store.listOpportunities()).toEqual([]);
    expect(await deps.store.listCycles()).toMatchObject([{ blocked: result.blocked, refactors: [], published: 0 }]);
  });

  it('ends the agent sessions that a stopped Sloppatrol left open', async () => {
    const { loaded, deps } = await setUp();
    const open = {
      sessionId: 's-open',
      role: 'refactorer',
      subject: 'refactor:r1',
      at: '2026-01-01T00:00:00.000Z',
    } as const;
    await deps.store.appendEvent({ ...open, kind: 'start', summary: 'refactorer started.' });
    script('surveyor', [{ tool: 'finish', input: { summary: 'Nothing new.' } }]);

    await surveyNow(loaded, deps);

    expect((await deps.store.events('s-open')).at(-1)).toMatchObject({
      kind: 'error',
      role: 'refactorer',
      subject: 'refactor:r1',
      summary: 'Interrupted: Sloppatrol stopped.',
    });
  });

  it('runs the checks on main once per commit, and again when the check commands change', async () => {
    const { repo, deps } = await setUp();
    const baseRuns = async () => (await deps.store.listCheckRuns()).filter((r) => r.purpose === 'base').length;
    await openBase(await loadConfig(repo), deps);
    await openBase(await loadConfig(repo), deps);
    expect(await baseRuns()).toBe(1);

    const file = join(repo, '.sloppatrol/sloppatrol.yml');
    writeFileSync(file, readFileSync(file, 'utf8').replace('run: node --test', 'run: node --test --test-reporter=dot'));
    await openBase(await loadConfig(repo), deps);
    expect(await baseRuns()).toBe(2);
  });

  it('names the branch without the type prefix, and never attempts a verified opportunity again by hand', async () => {
    const { loaded, deps } = await setUp(false);
    await deps.store.saveOpportunity(opportunity({ title: 'refactor(price): compute the total with reduce' }));
    script('refactorer', [
      { edit: { file: 'src/price.js', from: LOOP, to: REDUCE } },
      { tool: 'finish', input: { summary: 'reduce.' } },
    ]);
    script('assessor', reduceIsBetter);
    script('reviewer', approve);

    const refactor = await refactorNow(loaded, deps);

    expect(refactor.status).toBe('verified');
    expect(refactor.branch).toMatch(/^sloppatrol\/simplify-compute-the-total-with-reduce-[0-9a-f]{4}$/);
    await expect(refactorNow(loaded, deps)).rejects.toThrow('No open opportunity');
  });

  it('dismisses an opportunity the config now forbids, before any attempt', async () => {
    const { repo, deps } = await setUp(false);
    const file = join(repo, '.sloppatrol/sloppatrol.yml');
    writeFileSync(file, `${readFileSync(file, 'utf8')}uncheckedTests: [test/**]\n`);
    const loaded = await loadConfig(repo);
    const pinned = opportunity({ kind: 'characterize', side: 'tests', files: ['test/price.test.js'] });
    await deps.store.saveOpportunity(pinned);

    await expect(refactorNow(loaded, deps, pinned.id)).rejects.toThrow(
      'is dismissed, not open: No check runs test/price.test.js (uncheckedTests).',
    );
    expect(await deps.store.listRefactors()).toEqual([]);
  });

  it('rejects a change the blind assessor does not score better', async () => {
    const { loaded, deps } = await setUp(false);
    await deps.store.saveOpportunity(opportunity());
    script('refactorer', [
      { edit: { file: 'src/price.js', from: LOOP, to: REDUCE } },
      { tool: 'finish', input: { summary: 'reduce.' } },
    ]);
    script('assessor', [{ assess: [{ score: 2 }] }, { tool: 'finish', input: { summary: 'Same.' } }]);
    script('reviewer', approve);

    const refactor = await refactorNow(loaded, deps);

    expect(refactor.status).toBe('rejected');
    expect(refactor.reason).toBe('The target metric did not improve: simplicity 50 → 50.');
    expect(refactor.verdict?.review).toBeUndefined();
  });

  describe('a tests refactor', () => {
    const NEW_TEST = `
test('an empty cart totals zero', () => {
  assert.equal(total([]), 0);
});
`;
    const characterize = (mutation?: object) => [
      { edit: { file: 'test/price.test.js', from: "test('receipt lists", to: `${NEW_TEST}\ntest('receipt lists` } },
      ...(mutation ? [{ tool: 'set_mutation', input: mutation }] : []),
      { tool: 'finish', input: { summary: 'Pinned the empty cart.' } },
    ];
    const pin = () =>
      opportunity({ kind: 'characterize', side: 'tests', files: ['test/price.test.js'], metrics: ['tests'] });
    const moreTestsAreBetter = [
      { assess: [{ contains: 'empty cart', score: 3 }, { score: 2 }] },
      { tool: 'finish', input: { summary: 'Scored.' } },
    ];

    it('is kept when its tests catch a planted bug that the old tests miss', async () => {
      const { loaded, deps } = await setUp(false);
      await deps.store.saveOpportunity(pin());
      const emptyOnly = {
        file: 'src/price.js',
        find: 'return Math.round(sum * 100) / 100;',
        replace: 'return Math.round(sum * 100) / 100 || -1;',
        why: 'Only an empty cart totals 0, so only the empty cart test sees -1.',
      };
      script('refactorer', characterize(emptyOnly));
      script('assessor', moreTestsAreBetter);
      script('reviewer', approve);

      const refactor = await refactorNow(loaded, deps);

      expect(refactor.status, refactor.reason).toBe('verified');
      expect(refactor.proof?.behaviour.mutation).toMatchObject({
        caught: true,
        caughtBefore: false,
        file: 'src/price.js',
      });
      const mutations = (await deps.store.listCheckRuns()).filter((r) => r.purpose === 'mutation');
      expect(mutations.map((r) => [r.branch === 'main' ? 'main' : 'change', r.status])).toEqual([
        ['change', 'failed'],
        ['main', 'passed'],
      ]);
      expect(gitIn(refactor.worktree, 'status', '--porcelain')).toBe('');
      expect(gitIn(join(deps.store.root, 'checkouts', refactor.baseSha.slice(0, 12)), 'status', '--porcelain')).toBe(
        '',
      );

      // A source refactor of the covered file waits until the new tests land on main.
      await deps.store.saveOpportunity(opportunity());
      await expect(refactorNow(loaded, deps)).rejects.toThrow('No open opportunity');
    });

    it('is rejected when the old tests already catch its planted bug', async () => {
      const { loaded, deps } = await setUp(false);
      await deps.store.saveOpportunity(pin());
      script(
        'refactorer',
        characterize({
          file: 'src/price.js',
          find: 'let sum = 0;',
          replace: 'let sum = 1;',
          why: 'Every total is off by one.',
        }),
      );
      script('assessor', moreTestsAreBetter);

      const refactor = await refactorNow(loaded, deps);

      expect(refactor.reason).toBe(
        'The old tests already catch the planted bug: the new tests add no proven coverage.',
      );
    });

    it('is rejected when the planted bug survives, or when it plants none', async () => {
      const { loaded, deps } = await setUp(false);
      await deps.store.saveOpportunity(pin());
      script(
        'refactorer',
        characterize({ file: 'src/price.js', find: 'items.map(', replace: '[...items].map(', why: 'A copy.' }),
      );
      script('assessor', moreTestsAreBetter);
      const missed = await refactorNow(loaded, deps);
      expect(missed.reason).toBe('The tests did not catch the planted bug: they cannot fail where it matters.');

      script('refactorer', characterize());
      const none = await refactorNow(loaded, deps);
      expect(none.reason).toBe('No mutation: nothing shows the new tests can fail.');
    });
  });

  it('scores more of the repo each run, and weighs the scores by lines', async () => {
    const { loaded, deps } = await setUp(false);
    script('assessor', [
      { assess: [{ contains: 'export function total', score: 1 }, { score: 4 }] },
      { tool: 'finish', input: { summary: 'Scored.' } },
    ]);

    const first = await scoreNow(loaded, deps, 1);
    const second = await scoreNow(loaded, deps, 1);

    expect(first.coverage).toMatchObject({ files: 1, totalFiles: 2 });
    expect(second.coverage).toMatchObject({ files: 2, totalFiles: 2 });
    expect(second.coverage.lines).toBe(second.coverage.totalLines);
    // src/price.js (13 lines) scores 1 and test/price.test.js (14 lines) scores 4: (13 + 56) / 27.
    expect(second.means.clarity).toBe(2.56);
  });

  it('gives an assessor session no more files than its step budget can score', async () => {
    const { repo, loaded, deps } = await setUp(false);
    for (const name of ['tax', 'fee', 'tip'])
      writeFileSync(join(repo, `src/${name}.js`), `export const ${name} = 1;\n`);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'add small files');
    // Five small files fit one batch of lines, but not one session of 7 tool calls.
    writeFileSync(
      join(loaded.dir, 'sloppatrol.yml'),
      read(repo, '.sloppatrol/sloppatrol.yml').replace(
        /(assessor: \{.*), timeoutMinutes: 2 \}/,
        '$1, timeoutMinutes: 2, maxSteps: 7 }',
      ),
    );
    script('assessor', [{ assess: [{ score: 3 }] }, { tool: 'finish', input: { summary: 'Scored.' } }]);

    const scorecard = await scoreNow(await loadConfig(repo), deps);

    expect(scorecard.coverage).toMatchObject({ files: 5, totalFiles: 5 });
  });

  it('scores every file by default, also while the checks fail on main', async () => {
    const { repo, loaded, deps } = await setUp(false);
    writeFileSync(join(repo, 'src/tax.js'), 'export const tax = (amount) => amount * 0.2;\n');
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'add a file');
    writeFileSync(
      join(loaded.dir, 'sloppatrol.yml'),
      read(repo, '.sloppatrol/sloppatrol.yml').replace('node --test', 'exit 1'),
    );
    script('assessor', [{ assess: [{ score: 3 }] }, { tool: 'finish', input: { summary: 'Scored.' } }]);

    const scorecard = await scoreNow(await loadConfig(repo), deps);

    expect(scorecard.coverage).toMatchObject({ files: 3, totalFiles: 3 });
    expect(await deps.store.listCheckRuns()).toEqual([]);
  });
});
