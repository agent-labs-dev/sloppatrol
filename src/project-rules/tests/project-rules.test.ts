import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { confirmedFindings, refresh, vendor } from '../../project-rules/index.js';

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

  it('read the ledger audits write, and resolve its quote in the patrolled checkout', async () => {
    const source = temp();
    const checkout = temp();
    const lens = 'dead-code';
    const file = 'src/util.py';
    const quote = 'def used():';
    const id = createHash('sha256').update([lens, file, quote].join('\0')).digest('hex').slice(0, 10);
    mkdirSync(join(source, '.sloppatrol'), { recursive: true });
    writeFileSync(
      join(source, '.sloppatrol', 'ledger.json'),
      JSON.stringify({
        schema_version: 1,
        items: [
          {
            id,
            lens,
            file,
            quote,
            what: 'used has no caller',
            why: 'no reference in src, tests, scripts or CI',
            confidence: 'high',
            status: 'confirmed',
            reason: '',
            guard: 'lens-only: needs the caller search',
            first_seen: '2026-11-02',
            updated: '2026-11-02',
          },
        ],
      }),
    );
    mkdirSync(join(checkout, 'src'), { recursive: true });
    writeFileSync(join(checkout, file), `${quote}\n    pass\n`);
    expect(await confirmedFindings(checkout, join(source, '.sloppatrol'))).toMatchObject([{ id, file, line: 1 }]);
    // The quote is gone in the patrolled commit, so the finding no longer applies there.
    writeFileSync(join(checkout, file), 'def renamed():\n    pass\n');
    expect(await confirmedFindings(checkout, join(source, '.sloppatrol'))).toEqual([]);
  });
});
