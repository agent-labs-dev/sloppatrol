import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../config/index.js';

describe('a profile', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function repo(yaml: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-config-'));
    dirs.push(dir);
    mkdirSync(join(dir, '.sloppatrol'));
    writeFileSync(join(dir, '.sloppatrol/sloppatrol.yml'), yaml);
    return dir;
  }

  it('takes prepare and cleanup as Speedpatrol writes them, beside plain commands', async () => {
    const { config } = await loadConfig(
      repo(`prepare:
  - { run: bun install --frozen-lockfile }
  - pnpm run codegen
cleanup:
  - { run: pnpm lint --fix }
checks:
  - { name: test, run: node --test }
`),
    );

    expect(config.prepare).toEqual(['bun install --frozen-lockfile', 'pnpm run codegen']);
    expect(config.cleanup).toEqual(['pnpm lint --fix']);
  });

  it('names the shape it wants when a command is neither a string nor { run }', async () => {
    const dir = repo(`prepare:
  - { shell: bun install }
checks:
  - { name: test, run: node --test }
`);

    await expect(loadConfig(dir)).rejects.toThrow(
      'prepare.0: expected a command string such as "bun install", or { run: <command> }',
    );
  });
});
