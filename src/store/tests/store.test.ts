import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Store } from '../../store/index.js';

describe('the store', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every write of one file at once whole, and leaves no temp file', async () => {
    const dir = mkdtempSync(`${tmpdir()}/sloppatrol-store-`);
    dirs.push(dir);
    const store = new Store(dir);
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.savePatrolState({ cycles: i })));
    expect((await store.patrolState()).cycles).toBeGreaterThanOrEqual(0);
    expect(readdirSync(store.root)).toEqual(['patrol.json']);
  });
});
