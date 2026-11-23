import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createRuntime } from '../../agents/index.js';
import { loadConfig } from '../../config/index.js';
import { fingerprintOf } from '../../domain/index.js';
import { FakeGitHub } from '../../github/index.js';
import { refactorNow } from '../../patrol/index.js';
import { Store } from '../../store/index.js';
import { fixtureRepo, gitIn, script } from './fixture.js';

it('proves a comment-only refactor by its unchanged code, and plants no bug', async () => {
  const repo = fixtureRepo(false);
  try {
    const file = join(repo, 'src/price.js');
    writeFileSync(file, `// Loops over the items and adds them up.\n${readFileSync(file, 'utf8')}`);
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'narrate total');
    const loaded = await loadConfig(repo);
    loaded.config.metrics.enabled = false;
    loaded.config.agents.reviewer.enabled = false;
    const store = new Store(loaded.dir);
    await store.saveOpportunity({
      id: 'narration',
      fingerprint: fingerprintOf('simplify', ['src/price.js']),
      kind: 'simplify',
      side: 'source',
      title: 'Drop the narrating comment',
      files: ['src/price.js'],
      problem: 'A comment restates the loop.',
      change: 'Delete it.',
      benefits: 'Less to read.',
      metrics: ['clarity'],
      strength: 'strong',
      status: 'open',
      attempts: 0,
      foundAt: 'main',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    script('refactorer', [
      { edit: { file: 'src/price.js', from: '// Loops over the items and adds them up.\n', to: '' } },
      { tool: 'finish', input: { summary: 'The loop says it already.' } },
    ]);

    const result = await refactorNow(loaded, {
      store,
      github: new FakeGitHub(),
      runtimeFor: createRuntime,
      log: () => {},
    });

    expect(result.status, result.reason).toBe('verified');
    const [refactor] = await store.listRefactors();
    expect(refactor?.proof?.behaviour).toMatchObject({ codeUnchanged: true });
    expect(refactor?.proof?.behaviour.held).toBeUndefined();
    expect((await store.listCheckRuns()).map((r) => r.purpose)).not.toContain('mutation');
  } finally {
    delete process.env.FAKE_AGENT_REFACTORER;
    rmSync(repo, { recursive: true, force: true });
  }
});
