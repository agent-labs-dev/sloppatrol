import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { takeCensus } from '../../census/index.js';
import { DEFAULT_TEST_PATTERNS } from '../../globs/index.js';

const scope = { tests: DEFAULT_TEST_PATTERNS, focus: [], ignore: [] };

describe('the guardrails of a repo', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A real git repo with these files tracked. */
  function repo(files: Record<string, string>): string {
    const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-census-'));
    dirs.push(dir);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    return dir;
  }

  const present = async (dir: string) =>
    Object.fromEntries((await takeCensus(dir, scope)).guardrails.map((g) => [g.name, g.present]));

  it('are found from the files that set them up', async () => {
    const dir = repo({
      'AGENTS.md': '# Rules',
      'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
      'biome.json': '{}',
      '.dependency-cruiser.cjs': 'module.exports = {}',
      '.husky/pre-commit': 'pnpm test',
      '.github/workflows/ci.yml': 'on: push',
      'src/a.ts': 'export const a = 1;',
      'src/a.test.ts': "it('a', () => {});",
    });
    expect(await present(dir)).toEqual({
      'Agent guide': true,
      'Strict types': true,
      Linter: true,
      'Module boundaries': true,
      'Pre-commit hook': true,
      CI: true,
      Tests: true,
    });
  });

  const guardrail = async (dir: string, name: string) =>
    (await takeCensus(dir, scope)).guardrails.find((g) => g.name === name);

  it('credit strict types per language, for every language with a real share of the code', async () => {
    const rust = (n: number) => Object.fromEntries([...Array(n)].map((_, i) => [`crates/a/src/m${i}.rs`, 'fn f() {}']));
    const ts = (n: number, dir = 'ui/src') =>
      Object.fromEntries([...Array(n)].map((_, i) => [`${dir}/m${i}.ts`, 'export const a = 1;']));
    // More TypeScript files than Rust, with the strict tsconfig in a subfolder.
    const mixed = repo({ 'ui/tsconfig.json': '{ "compilerOptions": { "strict": true } }', ...ts(6), ...rust(4) });
    expect(await guardrail(mixed, 'Strict types')).toMatchObject({ present: true });
    // A monorepo: a solution file, packages extending a strict base, and one package that opts out.
    const loose = repo({
      'tsconfig.json': '{ "files": [], "references": [{ "path": "packages/a" }] }',
      'tsconfig.base.json': '{ "compilerOptions": { "strict": true } }',
      'packages/a/tsconfig.json': '{ "extends": "../../tsconfig.base.json" }',
      'packages/b/tsconfig.json': '{ "extends": "../../tsconfig.base.json", "compilerOptions": { "strict": false } }',
      ...ts(4, 'packages/a/src'),
    });
    expect(await guardrail(loose, 'Strict types')).toMatchObject({
      present: false,
      evidence: expect.stringContaining('packages/b/tsconfig.json'),
    });
    // Strict TypeScript does not cover a large share of plain JavaScript.
    const js = repo({
      'tsconfig.json': '{ "compilerOptions": { "strict": true } }',
      ...ts(3, 'src'),
      'lib/a.js': '1',
      'lib/b.js': '1',
    });
    expect(await guardrail(js, 'Strict types')).toMatchObject({
      present: false,
      evidence: expect.stringContaining('javascript'),
    });
  });

  it('show the commit hook by what it runs, and never score it', async () => {
    const slow = repo({ '.husky/pre-commit': 'pnpm test\npnpm build', 'src/a.ts': 'export const a = 1;' });
    expect(await guardrail(slow, 'Pre-commit hook')).toMatchObject({
      informational: true,
      evidence: expect.stringContaining('runs tests, runs a build'),
    });
    const none = repo({ '.github/workflows/ci.yml': 'on: push', 'src/a.ts': 'export const a = 1;' });
    expect(await guardrail(none, 'Pre-commit hook')).toMatchObject({ informational: true, present: false });
  });

  it('are missing in a bare repo, with the reason', async () => {
    const dir = repo({ 'src/a.js': 'module.exports = 1;' });
    const census = await takeCensus(dir, scope);
    expect(census.guardrails.every((g) => !g.present)).toBe(true);
    expect(census.guardrails.find((g) => g.name === 'Module boundaries')?.evidence).toBe(
      'Nothing stops a deep import across modules.',
    );
  });
});
