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
      '.github/workflows/ci.yml': 'on: push',
      'src/a.ts': 'export const a = 1;\n'.repeat(20),
      'src/a.test.ts': "it('a', () => {});",
    });
    expect(await present(dir)).toEqual({
      'Agent guide': true,
      'Strict types': true,
      Linter: true,
      'Module boundaries': true,
      CI: true,
      Tests: true,
    });
  });

  it('need a type check for each main language of a mixed repo', async () => {
    const files = {
      'Cargo.toml': '[package]',
      'src/main.rs': 'fn main() {}',
      'src/lib.rs': 'pub fn a() {}',
      'ui/src/app.ts': 'export const a = 1;',
      'ui/src/api/a.ts': 'export type A = 1;',
      'ui/src/api/b.ts': 'export type B = 1;',
      'ui/src/api/c.ts': 'export type C = 1;',
    };
    const loose = repo({ ...files, 'ui/tsconfig.json': '{ "compilerOptions": {} }' });
    const strict = repo({
      ...files,
      'ui/tsconfig.json': '{ "extends": "../config/strict" }',
      'config/strict.json': '{ "compilerOptions": { "strict": true } }',
    });
    const strictTypes = async (dir: string, ignore: string[] = []) =>
      (await takeCensus(dir, { ...scope, ignore })).guardrails.find((g) => g.name === 'Strict types');

    expect(await strictTypes(loose)).toMatchObject({
      present: false,
      evidence: 'No strict type check for typescript: a wrong type reaches run time.',
    });
    expect(await strictTypes(strict)).toMatchObject({
      present: true,
      evidence: 'ui/tsconfig.json: strict; rust: the compiler checks types',
    });
    expect((await strictTypes(strict, ['ui/src/api/**']))?.evidence).toBe(
      'rust: the compiler checks types; ui/tsconfig.json: strict',
    );
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
