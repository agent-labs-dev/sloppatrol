import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { vendor, vendoredIn } from '../../project-rules/index.js';

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
    const refreshed = await vendor(dir, vendoredIn(dir));
    expect(refreshed.edited).toEqual(['gate.py']);
    // A refresh updates only what the repo vendors.
    expect(refreshed.written).toEqual(['LICENSE']);
    expect(readFileSync(join(dir, 'gate.py'), 'utf8')).toBe('# changed here\n');
    // The record still holds the shipped hash, so the edit stays visible on the next refresh.
    expect((await vendor(dir)).edited).toEqual(['gate.py']);
  });
});
