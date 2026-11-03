import { appendFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRuntime } from '../../agents/index.js';
import { loadConfig } from '../../config/index.js';
import { FakeGitHub } from '../../github/index.js';
import { type PatrolDeps, regressed, reviewMarkdown, reviewNow, reviewTarget } from '../../patrol/index.js';
import { Store } from '../../store/index.js';
import { fixtureRepo, gitIn, script } from './fixture.js';

/** The assessor gives 1 of 4 (25%) to a file that says BAD, and 3 of 4 (75%) to every other file. */
const badIsWorse = [
  { assess: [{ contains: 'BAD', score: 1 }, { score: 3 }] },
  { tool: 'finish', input: { summary: 'Scored.' } },
];

describe('reviewTarget', () => {
  it('reads a number or a pull request URL as a pull request, and anything else as a git ref', () => {
    expect(reviewTarget('42')).toEqual({ kind: 'pr', number: 42 });
    expect(reviewTarget('#42')).toEqual({ kind: 'pr', number: 42 });
    expect(reviewTarget('https://github.com/acme/shop/pull/42')).toEqual({ kind: 'pr', number: 42 });
    expect(reviewTarget('https://github.com/acme/shop/pull/42/files')).toEqual({ kind: 'pr', number: 42 });
    expect(reviewTarget('feat/review')).toEqual({ kind: 'ref', ref: 'feat/review' });
    expect(reviewTarget('origin/main')).toEqual({ kind: 'ref', ref: 'origin/main' });
    expect(reviewTarget('42abc')).toEqual({ kind: 'ref', ref: '42abc' });
  });
});

describe('a review', () => {
  const repos: string[] = [];
  afterEach(() => {
    for (const repo of repos.splice(0)) rmSync(repo, { recursive: true, force: true });
  });

  /** A branch `feat` that makes src/price.js worse, adds src/tax.js and edits the README; main moves on after it. */
  async function setUp() {
    const repo = fixtureRepo(false);
    repos.push(repo);
    gitIn(repo, 'checkout', '-q', '-b', 'feat');
    appendFileSync(join(repo, 'src/price.js'), '// BAD\n');
    writeFileSync(join(repo, 'src/tax.js'), 'export const tax = 1;\n');
    writeFileSync(join(repo, 'README.md'), '# Shop\n');
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'feat');
    gitIn(repo, 'checkout', '-q', 'main');
    // A commit on main after the branch point: the review must not see it.
    writeFileSync(join(repo, 'src/fee.js'), 'export const fee = 2;\n');
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'main moves on');
    const loaded = await loadConfig(repo);
    const github = new FakeGitHub();
    const deps: PatrolDeps = { store: new Store(loaded.dir), github, runtimeFor: createRuntime, log: () => {} };
    return { repo, loaded, deps, github };
  }

  it('scores only the changed code files, against the merge base, worst regression first', async () => {
    const { repo, loaded, deps } = await setUp();
    script('assessor', badIsWorse);

    const review = await reviewNow(loaded, deps, { target: reviewTarget('feat') });

    expect(review.base.ref).toBe('main');
    expect(review.mergeBase).toBe(gitIn(repo, 'rev-parse', 'main~1'));
    expect(review.files).toEqual([
      { path: 'src/price.js', added: false, base: 75, head: 25, delta: -50 },
      { path: 'src/tax.js', added: true, base: undefined, head: 75, delta: undefined },
    ]);
    // Line-weighted: src/price.js has 14 lines at 1 of 4, src/tax.js 2 lines at 3 of 4.
    expect(review.total).toEqual({ base: 75, head: 31 });
    expect(regressed(review)).toBe(true);
    expect(reviewMarkdown(review)).toContain('| `src/price.js` | 75% | 25% | -50 |');
  });

  it('leaves the working tree and the worktree list as they were', async () => {
    const { repo, loaded, deps } = await setUp();
    script('assessor', badIsWorse);

    await reviewNow(loaded, deps, { target: reviewTarget('feat') });

    expect(gitIn(repo, 'branch', '--show-current')).toBe('main');
    expect(gitIn(repo, 'status', '--porcelain')).toBe('');
    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('removes the checkouts a stopped review left behind', async () => {
    const { repo, loaded, deps } = await setUp();
    gitIn(repo, 'worktree', 'add', '-q', '--detach', deps.store.path('reviews', 'stopped'), 'main');
    script('assessor', badIsWorse);

    await reviewNow(loaded, deps, { target: reviewTarget('feat') });

    expect(gitIn(repo, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('reuses the score of each file whose content was scored before', async () => {
    const { loaded, deps } = await setUp();
    script('assessor', badIsWorse);
    const first = await reviewNow(loaded, deps, { target: reviewTarget('feat') });
    // An assessor that scores everything 0 would change every row, if it ran.
    script('assessor', [{ assess: [{ score: 0 }] }, { tool: 'finish', input: { summary: 'Scored.' } }]);

    const second = await reviewNow(loaded, deps, { target: reviewTarget('feat') });

    expect(second.files).toEqual(first.files);
  });

  it('reviews a pull request by number, against its base branch, or against --base', async () => {
    const { repo, loaded, deps, github } = await setUp();
    github.refs.set(7, { headSha: gitIn(repo, 'rev-parse', 'feat'), headRef: 'feat', baseRef: 'main' });
    script('assessor', badIsWorse);

    const review = await reviewNow(loaded, deps, { target: reviewTarget('#7') });
    // --base names the pull request's own head: nothing changed.
    const againstHead = await reviewNow(loaded, deps, { target: reviewTarget('7'), base: 'feat' });

    expect(review.head.ref).toBe('#7 (feat)');
    expect(review.base.ref).toBe('main');
    expect(review.files.map((f) => f.path)).toEqual(['src/price.js', 'src/tax.js']);
    expect(againstHead.files).toEqual([]);
    expect(regressed(againstHead)).toBe(false);
  });

  it('compares a renamed file with its old path', async () => {
    const { repo, loaded, deps } = await setUp();
    gitIn(repo, 'checkout', '-q', '-b', 'rename', 'main~1');
    gitIn(repo, 'mv', 'src/price.js', 'src/cost.js');
    gitIn(repo, 'commit', '-q', '-m', 'rename');
    gitIn(repo, 'checkout', '-q', 'main');
    script('assessor', badIsWorse);

    const review = await reviewNow(loaded, deps, { target: reviewTarget('rename') });

    expect(review.files).toEqual([
      { path: 'src/cost.js', renamedFrom: 'src/price.js', added: false, base: 75, head: 75, delta: 0 },
    ]);
  });
});
