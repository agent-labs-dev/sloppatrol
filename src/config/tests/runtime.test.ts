import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig, resolveRuntime } from '../../config/index.js';

describe('the runtime of a role', () => {
  const dirs: string[] = [];
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-config-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** A PATH folder that holds executables with these names. */
  function path(...agents: string[]): string {
    const dir = temp();
    for (const name of agents) {
      writeFileSync(join(dir, name), '#!/bin/sh\n');
      chmodSync(join(dir, name), 0o755);
    }
    return dir;
  }

  async function config(yaml: string) {
    const repo = temp();
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(repo, '.sloppatrol'));
    writeFileSync(join(repo, '.sloppatrol/sloppatrol.yml'), `checks: [{ name: test, run: 'true' }]\n${yaml}`);
    return (await loadConfig(repo)).config;
  }

  it('defaults to the first installed agent CLI, claude before codex', async () => {
    const settings = await config('');
    expect(resolveRuntime(settings, 'surveyor', path('codex'))).toMatchObject({ runtime: 'cli', label: 'codex' });
    expect(resolveRuntime(settings, 'surveyor', path('codex', 'claude'))).toMatchObject({ label: 'claude' });
  });

  it('gives the refactorer an editor and the other roles a reader', async () => {
    const settings = await config('agent: claude\n');
    const reader = resolveRuntime(settings, 'reviewer', '');
    const editor = resolveRuntime(settings, 'refactorer', '');
    expect(reader.runtime === 'cli' && reader.command).toContain("--tools 'Read,Grep,Glob'");
    expect(editor.runtime === 'cli' && editor.command).toContain('--permission-mode auto');
  });

  it('lets one role run on another agent or on a model', async () => {
    const settings = await config(
      'agent: codex\nagents:\n  reviewer: { use: { runtime: model, via: anthropic, model: claude-opus-5-5 } }\n',
    );
    expect(resolveRuntime(settings, 'surveyor', '')).toMatchObject({ label: 'codex' });
    expect(resolveRuntime(settings, 'reviewer', '')).toEqual({
      runtime: 'model',
      via: 'anthropic',
      model: 'claude-opus-5-5',
    });
  });

  it('says what to install when no agent CLI is found', async () => {
    const settings = await config('');
    expect(() => resolveRuntime(settings, 'surveyor', path())).toThrow(ConfigError);
    expect(() => resolveRuntime(settings, 'surveyor', path())).toThrow(/Install claude, codex or opencode/);
  });
});
