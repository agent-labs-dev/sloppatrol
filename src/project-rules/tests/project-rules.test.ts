import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { refresh, vendor } from '../../project-rules/index.js';

describe('the project-rules tools', () => {
  const dirs: string[] = [];
  const temp = () => {
    const dir = mkdtempSync(join(tmpdir(), 'sloppatrol-rules-'));
    dirs.push(dir);
    return dir;
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('vendor the tools, and keep a copy edited in the repo on refresh', async () => {
    const dir = temp();
    expect((await vendor(dir)).written).toEqual(['gate.py', 'agents.py', 'LICENSE']);
    expect(readFileSync(join(dir, 'SOURCE.md'), 'utf8')).toMatch(/\| `gate.py` \| `[0-9a-f]{64}` \|/);
    writeFileSync(join(dir, 'gate.py'), '# changed here\n');
    rmSync(join(dir, 'agents.py'));
    const refreshed = await refresh(dir);
    expect(refreshed.edited).toEqual(['gate.py']);
    // A refresh updates only what the repo vendors.
    expect(refreshed.written).toEqual(['LICENSE']);
    expect(readFileSync(join(dir, 'gate.py'), 'utf8')).toBe('# changed here\n');
    // The record still holds the shipped hash, so the edit stays visible on the next refresh.
    expect((await vendor(dir)).edited).toEqual(['gate.py']);
  });

  it('vendor every tool on a refresh when none is vendored yet', async () => {
    expect((await refresh(temp())).written).toEqual(['gate.py', 'agents.py', 'LICENSE']);
  });

  it('read a record whose table a formatter padded', async () => {
    const dir = temp();
    const old = '# an earlier release\n';
    writeFileSync(join(dir, 'gate.py'), old);
    const hash = createHash('sha256').update(old).digest('hex');
    writeFileSync(
      join(dir, 'SOURCE.md'),
      `| File      | sha256 |\n| --------- | ------ |\n| \`gate.py\`   | \`${hash}\` |\n`,
    );
    expect(await vendor(dir, ['gate.py'])).toMatchObject({ written: ['gate.py'], edited: [] });
  });

  it('keep a copy that has no record on every refresh', async () => {
    const dir = temp();
    writeFileSync(join(dir, 'gate.py'), '# copied by hand\n');
    expect((await vendor(dir, ['gate.py'])).edited).toEqual(['gate.py']);
    expect((await vendor(dir, ['gate.py'])).edited).toEqual(['gate.py']);
    expect(readFileSync(join(dir, 'gate.py'), 'utf8')).toBe('# copied by hand\n');
  });
});
