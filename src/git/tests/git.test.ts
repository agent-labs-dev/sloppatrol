import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkout, git } from '../index.js';

it('recreates a cached checkout when its source repository is replaced', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sloppatrol-git-'));
  const source = join(root, 'source');
  const cached = join(root, 'cached');
  const initialize = async () => {
    await git(root, ['init', '-b', 'main', source]);
    await git(source, [
      '-c',
      'user.name=test',
      '-c',
      'user.email=test@example.com',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ]);
    return git(source, ['rev-parse', 'HEAD']);
  };
  try {
    const first = await initialize();
    expect(await checkout(source, cached, first)).toBe(true);
    expect(await checkout(source, cached, first)).toBe(false);
    await rm(source, { recursive: true, force: true });
    const replacement = await initialize();
    expect(await checkout(source, cached, replacement)).toBe(true);
    expect(await git(cached, ['rev-parse', 'HEAD'])).toBe(replacement);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
