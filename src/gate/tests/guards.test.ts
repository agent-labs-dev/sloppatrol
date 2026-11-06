import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type GuardRules, inspectChange } from '../../gate/index.js';
import { DEFAULT_TEST_PATTERNS } from '../../globs/index.js';

const rules = (overrides: Partial<GuardRules> = {}): GuardRules => ({
  side: 'source',
  tests: DEFAULT_TEST_PATTERNS,
  ignore: [],
  uncheckedTests: [],
  maxFiles: 12,
  maxLines: 600,
  ...overrides,
});

const git = (dir: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();

/** A real repo with one commit; the test edits its working tree like an agent would. */
function repo(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-gate-'));
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  for (const [path, text] of Object.entries(files)) write(path, text);
  git(dir, 'init', '-q');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, base: git(dir, 'rev-parse', 'HEAD'), write };
}

describe('the guards', () => {
  const dirs: string[] = [];
  const make = (files: Record<string, string>) => {
    const r = repo(files);
    dirs.push(r.dir);
    return r;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('pass a clean source change', async () => {
    const { dir, base, write } = make({ 'src/a.ts': 'export const a = 1;\n' });
    write('src/a.ts', 'export const a = 2 - 1;\n');
    expect(await inspectChange(dir, base, rules())).toMatchObject({
      findings: [],
      stat: { files: 1, added: 1, removed: 1 },
    });
  });

  it('reject an empty change', async () => {
    const { dir, base } = make({ 'src/a.ts': 'x\n' });
    expect((await inspectChange(dir, base, rules())).findings.map((f) => f.guard)).toEqual(['empty']);
  });

  it('keep a test refactor out of the source', async () => {
    const { dir, base, write } = make({ 'src/a.ts': 'x\n', 'src/a.test.ts': "it('a', () => {});\n" });
    write('src/a.ts', 'y\n');
    write('src/a.test.ts', "it('a', () => { expect(1).toBe(1); });\n");
    const { findings } = await inspectChange(dir, base, rules({ side: 'tests' }));
    expect(findings).toEqual([
      { guard: 'one-side', file: 'src/a.ts', detail: 'A tests refactor may not change a source file.' },
    ]);
  });

  it('freeze manifests, tool configs and ignored paths', async () => {
    const { dir, base, write } = make({ 'package.json': '{}\n', 'tsconfig.json': '{}\n', 'gen/api.ts': 'x\n' });
    write('package.json', '{ "dependencies": { "left-pad": "1" } }\n');
    write('tsconfig.json', '{ "compilerOptions": { "strict": false } }\n');
    write('gen/api.ts', 'y\n');
    const { findings } = await inspectChange(dir, base, rules({ ignore: ['gen/**'] }));
    expect(findings.filter((f) => f.guard === 'frozen').map((f) => f.file)).toEqual([
      'gen/api.ts',
      'package.json',
      'tsconfig.json',
    ]);
  });

  it('reject an added suppression, but not one that only moves', async () => {
    const { dir, base, write } = make({ 'src/a.ts': '// @ts-expect-error legacy\nold();\n', 'src/b.ts': 'x\n' });
    write('src/a.ts', 'old();\n');
    write('src/b.ts', '// @ts-expect-error legacy\nx\n');
    expect((await inspectChange(dir, base, rules())).findings).toEqual([]);
    write('src/b.ts', '// @ts-expect-error legacy\nconst y = z as any;\n');
    expect((await inspectChange(dir, base, rules())).findings).toEqual([
      { guard: 'suppression', file: 'src/b.ts', detail: 'Adds a type escape.' },
    ]);
  });

  it('reject a test refactor that removes a test case or skips one', async () => {
    const { dir, base, write } = make({ 'a.test.ts': "it('one', f);\nit('two', g);\n" });
    write('a.test.ts', "it('one and two', () => { f(); g(); });\n");
    expect((await inspectChange(dir, base, rules({ side: 'tests' }))).findings.map((f) => f.guard)).toEqual([
      'tests-kept',
    ]);
    // A skipped test no longer runs, so it also counts as a removed one.
    write('a.test.ts', "it('one', f);\nit.skip('two', g);\n");
    expect((await inspectChange(dir, base, rules({ side: 'tests' }))).findings).toEqual([
      { guard: 'suppression', file: 'a.test.ts', detail: 'Adds a skipped or focused test.' },
      { guard: 'tests-kept', detail: 'Removes 1 test case(s). Tests may move, never go.' },
    ]);
  });

  it('count a moved file by its changed lines only', async () => {
    const body = Array.from({ length: 700 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const { dir, base } = make({ 'src/old-name.ts': `${body}\n` });
    renameSync(join(dir, 'src/old-name.ts'), join(dir, 'src/values.ts'));
    expect(await inspectChange(dir, base, rules())).toMatchObject({ findings: [], files: ['src/values.ts'] });
  });

  it('reject a change over the size limit', async () => {
    const { dir, base, write } = make({ 'src/a.ts': 'x\n' });
    write('src/a.ts', `${'y\n'.repeat(20)}`);
    expect((await inspectChange(dir, base, rules({ maxLines: 10 }))).findings).toEqual([
      { guard: 'size', detail: 'Changes 21 lines; the limit is 10.' },
    ]);
  });

  it('reject a test change no check runs', async () => {
    const { dir, base, write } = make({
      'tests/integration/test_a.py': 'def test_a(): pass\n',
      'tests/unit/test_b.py': 'x\n',
    });
    write('tests/integration/test_a.py', 'def test_a():\n    assert True\n');
    const { findings } = await inspectChange(
      dir,
      base,
      rules({ side: 'tests', uncheckedTests: ['tests/integration/**'] }),
    );
    expect(findings).toEqual([
      {
        guard: 'unchecked',
        file: 'tests/integration/test_a.py',
        detail: 'No check runs this test file, so nothing proves the change.',
      },
    ]);
  });
});
