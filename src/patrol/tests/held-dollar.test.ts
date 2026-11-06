import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRuntime } from '../../agents/index.js';
import { loadConfig } from '../../config/index.js';
import { fingerprintOf } from '../../domain/index.js';
import { FakeGitHub } from '../../github/index.js';
import { refactorNow } from '../../patrol/index.js';
import { Store } from '../../store/index.js';
import { fixtureRepo, gitIn, script } from './fixture.js';

it('rejects loss of coverage of a kept line containing a dollar literal', async () => {
  const repo = fixtureRepo(false);
  try {
    writeFileSync(join(repo, 'src/price.js'), "export function total(items) {\n  return '$' + items.length;\n}\n");
    writeFileSync(
      join(repo, 'test/price.test.js'),
      "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { total } from '../src/price.js';\ntest('formats the count', () => assert.equal(total([1]), '$1'));\n",
    );
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'format a count with a currency prefix');
    const loaded = await loadConfig(repo);
    loaded.config.metrics.enabled = false;
    loaded.config.agents.reviewer.enabled = false;
    const store = new Store(loaded.dir);
    await store.saveOpportunity({
      id: 'currency',
      fingerprint: fingerprintOf('simplify', ['src/price.js']),
      kind: 'simplify',
      side: 'source',
      title: 'Format the count',
      files: ['src/price.js'],
      problem: 'Formatting is inline.',
      change: 'Restructure formatting.',
      benefits: 'Clear formatting.',
      metrics: ['simplicity'],
      strength: 'strong',
      status: 'open',
      attempts: 0,
      foundAt: 'main',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    script('refactorer', [
      { edit: { file: 'src/price.js', from: '  return ', to: '  if (items.length > 99) {\n    return ' } },
      {
        edit: {
          file: 'src/price.js',
          from: '\n}\n',
          to: '\n  }\n  return String.fromCharCode(36).concat(String(items.length));\n}\n',
        },
      },
      { tool: 'finish', input: { summary: 'Same formatting, with a branch.' } },
    ]);

    const result = await refactorNow(loaded, {
      store,
      github: new FakeGitHub(),
      runtimeFor: createRuntime,
      log: () => {},
    });

    expect(result.status, result.reason).toBe('rejected');
    expect(result.reason).toContain('the refactor moved code out of their reach');
  } finally {
    delete process.env.FAKE_AGENT_REFACTORER;
    rmSync(repo, { recursive: true, force: true });
  }
});
