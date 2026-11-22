import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  fileLines: 600,
  dirFiles: 40,
};
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function comments(name: string, before: string, after: string) {
  const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-comment-language-'));
  dirs.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
      cwd: dir,
      encoding: 'utf8',
    }).trim();
  mkdirSync(join(dir, 'src'));
  const path = join(dir, 'src', name);
  writeFileSync(path, before);
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(path, after);
  return (await inspectChange(dir, base, rules)).findings.filter((f) => f.guard === 'comments');
}

describe('comment budgets respect language-specific lexical state', () => {
  it('counts comments following a Rust lifetime', async () => {
    const code = "pub fn length(value: &'static str) -> usize { value.len() }\n";
    expect(await comments('length.rs', code, `${code}// Explanation of the result.\n`)).toEqual([
      expect.objectContaining({ guard: 'comments' }),
    ]);
  });

  it('does not count a shell length expansion as a comment', async () => {
    expect(await comments('length.sh', 'value=abc\n', 'value=abc\nlength=${#value}\n')).toEqual([]);
  });

  it('counts comments following a Go raw string ending in a backslash', async () => {
    const code = 'package value\n\nconst Path = `C:\\`\n';
    expect(await comments('path.go', code, `${code}// Explanation of the path.\n`)).toEqual([
      expect.objectContaining({ guard: 'comments' }),
    ]);
  });

  it('counts added Lua long-comment bodies with unchanged delimiters', async () => {
    expect(
      await comments(
        'value.lua',
        '--[[\nExisting explanation.\n]]\nreturn 1\n',
        '--[[\nExisting explanation.\nAnother explanation.\n]]\nreturn 1\n',
      ),
    ).toEqual([expect.objectContaining({ guard: 'comments' })]);
  });
});

it.each([
  ['text.rs', 'pub const TEXT: &str = r#"old"#;\n', 'pub const TEXT: &str = r#"// value"#;\n'],
  ['char.rs', "pub const CH: char = 'a';\n", "pub const CH: char = '/';\n"],
  ['text.lua', 'local text = [[old]]\n', 'local text = [=[\n-- value\n]=]\n'],
  ['text.sh', 'value=old\n', 'value=abc#def\nvalue=\\#text\n'],
  ['text.go', 'package value\nconst Text = `old`\n', 'package value\nconst Text = `// value`\n'],
])('keeps comment-looking literals in %s out of the budget', async (name, before, after) => {
  expect(await comments(name, before, after)).toEqual([]);
});

it('counts Lua long comments with equals in their delimiters', async () => {
  expect(
    await comments('value.lua', '--[=[\nExisting.\n]=]\nreturn 1\n', '--[=[\nExisting.\nAdded.\n]=]\nreturn 1\n'),
  ).toEqual([expect.objectContaining({ guard: 'comments' })]);
});
