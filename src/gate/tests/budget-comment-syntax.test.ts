import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type GuardRules, inspectChange } from '../../gate/index.js';
import { DEFAULT_TEST_PATTERNS } from '../../globs/index.js';

const rules: GuardRules = {
  side: 'source',
  tests: DEFAULT_TEST_PATTERNS,
  ignore: [],
  uncheckedTests: [],
  maxFiles: 12,
  maxLines: 600,
  fileLines: 600,
  dirFiles: 40,
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function comments(path: string, before: string, after: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-comment-syntax-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  mkdirSync(dirname(join(dir, path)), { recursive: true });
  writeFileSync(join(dir, path), before);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(dir, path), after);
  return (await inspectChange(dir, base, rules)).findings.filter((f) => f.guard === 'comments');
}

describe('comment budgets follow the language and surrounding syntax', () => {
  it('does not count a TypeScript private field as a comment', async () => {
    expect(
      await comments(
        'src/counter.ts',
        'export class Counter {\n  value = 1;\n  get() { return this.value; }\n}\n',
        'export class Counter {\n  #value = 1;\n  get() { return this.#value; }\n}\n',
      ),
    ).toEqual([]);
  });

  it('does not count a generator method as a comment', async () => {
    expect(
      await comments(
        'src/values.ts',
        'export const values = {\n  all() { return [1].values(); }\n};\n',
        'export const values = {\n  *all() { yield 1; }\n};\n',
      ),
    ).toEqual([]);
  });

  it('does not count comment-looking text inside a template literal', async () => {
    expect(
      await comments('src/text.ts', 'export const text = `\nold\n`;\n', 'export const text = `\n// new\n`;\n'),
    ).toEqual([]);
  });

  it('counts added block-comment bodies even when the delimiters are unchanged', async () => {
    expect(
      await comments(
        'src/value.ts',
        '/*\nExisting explanation.\n*/\nexport const value = 1;\n',
        '/*\nExisting explanation.\nAnother explanation.\n*/\nexport const value = 1;\n',
      ),
    ).toEqual([expect.objectContaining({ guard: 'comments' })]);
  });

  it('counts a new trailing comment on a code line', async () => {
    expect(
      await comments('src/value.ts', 'export const value = 1;\n', 'export const value = 1; // explanation\n'),
    ).toEqual([expect.objectContaining({ guard: 'comments' })]);
  });
});

describe('comment budgets retain syntax context', () => {
  it.each([
    ['src/area.ts', 'export const area = 2 * 3;\n', 'export const area = 2\n  * 3;\n'],
    ['src/pattern.ts', 'export const pattern = /old/;\n', 'export const pattern = /[/*]/;\n'],
    ['src/text.ts', 'export const text = "old";\n', 'export const text = "// value";\n'],
    ['src/view.tsx', 'export const view = <div>old</div>;\n', 'export const view = <div>// value</div>;\n'],
    ['src/text.py', 'text = "old"\n', 'text = "# value"\n'],
    ['src/value.sql', "SELECT 'old';\n", "SELECT '-- value';\n"],
  ])('allows executable syntax in %s', async (path, before, after) => {
    expect(await comments(path, before, after)).toEqual([]);
  });

  it.each([
    ['src/value.ts', 'export const value = {};\n', 'export const value = { /* explanation */ };\n'],
    ['src/value.ts', 'export const value = `text`;\n', 'export const value = `${1 /* explanation */}`;\n'],
    ['src/value.py', 'value = 1\n', 'value = 1 # explanation\n'],
    ['src/value.sql', 'SELECT 1;\n', 'SELECT 1; -- explanation\n'],
    ['src/value.go', 'package value\n', 'package value // explanation\n'],
  ])('counts comments in %s', async (path, before, after) => {
    expect(await comments(path, before, after)).toEqual([expect.objectContaining({ guard: 'comments' })]);
  });
});
