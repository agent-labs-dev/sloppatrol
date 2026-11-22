import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  fileLines: 5,
  dirFiles: 40,
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function repo(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-base-whitespace-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src/value.ts'), text);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  return { dir, base: git('rev-parse', 'HEAD') };
}

const body = Array.from({ length: 6 }, (_, i) => `export const value${i} = ${i};`).join('\n');

describe('base and head file budgets count the same whitespace', () => {
  it.each([
    ['leading', `\n\n${body}\n`],
    ['trailing', `${body}\n\n\n`],
  ])('permits an equal-length edit with %s blank lines', async (_name, text) => {
    const { dir, base } = repo(text);
    writeFileSync(join(dir, 'src/value.ts'), text.replace('value0', 'renamed0'));
    expect((await inspectChange(dir, base, rules)).findings).toEqual([]);
  });

  it('permits a pure rename of a long file with trailing blank lines', async () => {
    const { dir, base } = repo(`${body}\n\n\n`);
    renameSync(join(dir, 'src/value.ts'), join(dir, 'src/renamed.ts'));
    expect((await inspectChange(dir, base, rules)).findings).toEqual([]);
  });
});
