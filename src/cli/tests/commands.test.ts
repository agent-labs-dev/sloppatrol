import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

describe('CLI command selection', () => {
  let cwd: string;
  const root = resolve(import.meta.dirname, '../../..');
  const cli = join(root, 'dist/cli/index.js');
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 5000 });

  beforeAll(() => {
    // Build the executable under test so these tests do not depend on a prior `pnpm build`.
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    const build = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json'], { cwd: root, encoding: 'utf8' });
    expect(build.status, build.stdout + build.stderr).toBe(0);
    cwd = mkdtempSync(join(tmpdir(), 'sloppatrol-commands-'));
  }, 120_000);
  afterAll(() => rmSync(cwd, { recursive: true, force: true }));

  it.each(['audit', 'reveiw'])('rejects %s before looking for configuration or starting a patrol', (command) => {
    const result = run('--cwd', cwd, command, 'some-branch', '--no-open');
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`Unknown command "${command}"`);
    expect(result.stderr).toContain('sloppatrol --help');
    expect(result.stderr).not.toContain('dashboard:');
    expect(result.stdout).toBe('');
    expect(readdirSync(cwd)).toEqual([]);
  });

  it.each([{ args: [] }, { args: ['--no-open'] }, { args: ['patrol', '--no-open'] }])(
    'keeps the patrol default for $args',
    ({ args }) => {
      const result = run(...args);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('sloppatrol.yml');
      expect(result.stderr).not.toContain('Unknown command');
    },
  );

  it('still accepts the supported review command and global help', () => {
    for (const args of [['--help'], ['review', 'some-branch', '--help']]) {
      const result = run(...args);
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('sloppatrol review <pr|ref>');
      expect(result.stderr).toBe('');
    }
  });

  it.each([
    { lock: 'bun.lock', manager: undefined, expected: 'bun' },
    { lock: 'bun.lockb', manager: undefined, expected: 'bun' },
    { lock: 'package-lock.json', manager: 'bun@1.3.0', expected: 'bun' },
    { lock: 'pnpm-lock.yaml', manager: 'yarn@4.0.0', expected: 'yarn' },
  ])('initializes $expected from declared metadata with $lock', ({ lock, manager, expected }) => {
    const project = mkdtempSync(join(cwd, 'worktree-trial-'));
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({
        name: '@example/stable-project',
        packageManager: manager,
        scripts: { test: 'test-command' },
      }),
    );
    writeFileSync(join(project, lock), '');
    const result = run('--cwd', project, 'init');
    expect(result.status, result.stderr).toBe(0);
    const config = parse(readFileSync(join(project, '.sloppatrol/sloppatrol.yml'), 'utf8'));
    expect(config.project.name).toBe('@example/stable-project');
    expect(config.prepare).toEqual([`${expected} install --frozen-lockfile`]);
    expect(config.checks).toEqual([{ name: 'test', run: `${expected} run test`, tests: true }]);
  });

  it('uses the remote repository name when no package name exists', () => {
    const project = mkdtempSync(join(cwd, 'worktree-trial-'));
    for (const args of [['init'], ['remote', 'add', 'origin', 'git@github.com:example/stable-project.git']]) {
      expect(spawnSync('git', args, { cwd: project }).status).toBe(0);
    }
    const result = run('--cwd', project, 'init');
    expect(result.status, result.stderr).toBe(0);
    const config = parse(readFileSync(join(project, '.sloppatrol/sloppatrol.yml'), 'utf8'));
    expect(config.project.name).toBe('stable-project');
  });
});
