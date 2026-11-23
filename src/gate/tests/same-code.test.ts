import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { codeUnchanged } from '../../gate/index.js';

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();

describe('a change that edits only comments', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** Commits `before`, then `after` on top, and asks whether the code stayed the same. */
  async function unchanged(before: Record<string, string>, after: Record<string, string | null>): Promise<boolean> {
    const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-same-code-'));
    dirs.push(dir);
    const write = (files: Record<string, string | null>) => {
      for (const [path, text] of Object.entries(files)) {
        if (text === null) rmSync(join(dir, path));
        else {
          mkdirSync(dirname(join(dir, path)), { recursive: true });
          writeFileSync(join(dir, path), text);
        }
      }
      git(dir, 'add', '-A');
      git(dir, 'commit', '-q', '--allow-empty', '-m', 'step');
    };
    git(dir, 'init', '-q');
    write(before);
    const base = git(dir, 'rev-parse', 'HEAD');
    write(after);
    return codeUnchanged(dir, base);
  }

  it.each([
    [
      'line, block and trailing comments removed',
      { 'src/a.ts': '/** Units: ms. */\nexport const wait = 5; // why\n\n/* gone */\nexport const b = 1;\n' },
      { 'src/a.ts': 'export const wait = 5;\nexport const b = 1;\n' },
      true,
    ],
    [
      'a comment rewritten and moved to the owner doc',
      { 'src/a.py': '# old note\nx = 1\n', 'docs/a.md': '# A\n' },
      { 'src/a.py': '# External: the API caps at 1. Retires when v2 ships.\nx = 1\n', 'docs/a.md': '# A\n\nA note.\n' },
      true,
    ],
    [
      'text inside a string changed',
      { 'src/a.ts': 'const u = "a // b";\n' },
      { 'src/a.ts': 'const u = "a // c";\n' },
      false,
    ],
    [
      'code after a regular expression with slashes',
      { 'src/a.ts': 'const ok = /^https?:\\/\\//.test(a); // note\n' },
      { 'src/a.ts': 'const ok = /^https?:\\/\\//.test(b);\n' },
      false,
    ],
    [
      'a Python docstring removed',
      { 'src/a.py': 'def f():\n    """Say hi."""\n    return 1\n' },
      { 'src/a.py': 'def f():\n    return 1\n' },
      false,
    ],
    ['a new code file', { 'src/a.ts': 'export const a = 1;\n' }, { 'src/b.ts': '// b\n' }, false],
    ['a deleted code file', { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'x\n' }, { 'src/b.ts': null }, false],
    ['code after a shell length expansion', { 'run.sh': 'echo ${#x} # note\n' }, { 'run.sh': 'echo ${#y}\n' }, false],
    [
      'a language it cannot read',
      { 'src/a.hs': '-- note\nmain = pure ()\n' },
      { 'src/a.hs': 'main = pure ()\n' },
      false,
    ],
  ])('%s', async (_name, before, after, expected) => {
    expect(await unchanged(before, after)).toBe(expected);
  });
});
