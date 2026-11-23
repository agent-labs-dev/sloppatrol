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
      'line, block, JSDoc and trailing comments removed',
      {
        'src/a.ts': '// header\n/** Units: ms. */\nexport const wait = 5; // why\n\n/* gone */\nexport const b = 1;\n',
      },
      { 'src/a.ts': 'export const wait = 5;\nexport const b = 1;\n' },
      true,
    ],
    [
      'a JSX comment rewritten, and a note moved to the owner doc',
      { 'src/a.tsx': 'export const A = () => <p>{/* old */}hi</p>;\n', 'docs/a.md': '# A\n' },
      {
        'src/a.tsx': 'export const A = () => <p>{/* External: x. Retires when y. */}hi</p>;\n',
        'docs/a.md': '# A\n\nA note.\n',
      },
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
      'a block comment whose line break inserted a semicolon',
      { 'src/a.js': 'export function f() {\n  return /*\n  note\n  */ 7;\n}\n' },
      { 'src/a.js': 'export function f() {\n  return 7;\n}\n' },
      false,
    ],
    [
      'a block comment with CR inserting a semicolon',
      { 'src/a.js': 'export function f() { return /*\r note */ 7; }\n' },
      { 'src/a.js': 'export function f() { return 7; }\n' },
      false,
    ],
    [
      'a block comment with U+2028 inserting a semicolon',
      { 'src/a.js': 'export function f() { return /*\u2028 note */ 7; }\n' },
      { 'src/a.js': 'export function f() { return 7; }\n' },
      false,
    ],
    [
      'a block comment with U+2029 inserting a semicolon',
      { 'src/a.js': 'export function f() { return /*\u2029 note */ 7; }\n' },
      { 'src/a.js': 'export function f() { return 7; }\n' },
      false,
    ],
    [
      'a leading space in JSX text',
      { 'src/a.tsx': 'export const v = <p> hi</p>;\n' },
      { 'src/a.tsx': 'export const v = <p>hi</p>;\n' },
      false,
    ],
    [
      'a trailing space in JSX text',
      { 'src/a.tsx': 'export const v = <p>hi </p>;\n' },
      { 'src/a.tsx': 'export const v = <p>hi</p>;\n' },
      false,
    ],
    [
      'a JSX factory pragma changed',
      { 'src/a.tsx': '/** @jsx first */\nexport const v = <p/>;\n' },
      { 'src/a.tsx': '/** @jsx second */\nexport const v = <p/>;\n' },
      false,
    ],
    [
      'a JSX import-source pragma removed',
      { 'src/a.tsx': '/** @jsxImportSource preact */\nexport const v = <p/>;\n' },
      { 'src/a.tsx': 'export const v = <p/>;\n' },
      false,
    ],
    [
      'a triple-slash reference directive changed',
      { 'src/a.ts': '/// <reference types="node" />\nexport const n = 1;\n' },
      { 'src/a.ts': '/// <reference types="vite/client" />\nexport const n = 1;\n' },
      false,
    ],
    [
      'a TypeScript suppression directive removed',
      { 'src/a.ts': '// @ts-expect-error intentional\nexport const n: number = "x";\n' },
      { 'src/a.ts': 'export const n: number = "x";\n' },
      false,
    ],
    [
      'a bundler pure annotation removed',
      { 'src/a.ts': 'export const x = /* #__PURE__ */ make();\n' },
      { 'src/a.ts': 'export const x = make();\n' },
      false,
    ],
    [
      'a trailing sourceMappingURL directive changed',
      { 'src/a.js': 'export const x = 1;\n//# sourceMappingURL=a.js.map\n' },
      { 'src/a.js': 'export const x = 1;\n//# sourceMappingURL=b.js.map\n' },
      false,
    ],
    [
      'a shebang changed',
      { 'src/a.ts': '#!/usr/bin/env node\nexport const x = 1;\n' },
      { 'src/a.ts': '#!/usr/bin/env bun\nexport const x = 1;\n' },
      false,
    ],
    [
      'a trailing space inside a template literal',
      { 'src/a.ts': 'export const t = `a \nb`; // note\n' },
      { 'src/a.ts': 'export const t = `a\nb`;\n' },
      false,
    ],
    ['a new code file', { 'src/a.ts': 'export const a = 1;\n' }, { 'src/b.ts': '// b\n' }, false],
    ['a deleted code file', { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'x\n' }, { 'src/b.ts': null }, false],
    ['a Python comment, with no parser here', { 'src/a.py': '# note\nx = 1\n' }, { 'src/a.py': 'x = 1\n' }, false],
    [
      'a Go build directive',
      { 'main.go': '//go:build linux\n\npackage main\n' },
      { 'main.go': '//go:build darwin\n\npackage main\n' },
      false,
    ],
    [
      'MDX, which runs code',
      { 'docs/a.mdx': 'export const n = 1;\n', 'src/a.ts': '// x\nexport const a = 1;\n' },
      { 'docs/a.mdx': 'export const n = 2;\n', 'src/a.ts': 'export const a = 1;\n' },
      false,
    ],
  ])('%s', async (_name, before, after, expected) => {
    expect(await unchanged(before, after)).toBe(expected);
  });
});
