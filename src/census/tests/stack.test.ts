import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { takeCensus } from '../index.js';

describe('detectStack', () => {
  it('counts Lua files as a first-class language', async () => {
    const root = mkdtempSync(join(tmpdir(), 'sloppatrol-stack-'));
    try {
      for (const [path, text] of [
        ['core.lua', 'return {}\n'],
        ['tests/core_spec.lua', 'describe("core", function() end)\n'],
      ] as [string, string][]) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), text);
      }
      execFileSync('git', ['init', '-q'], { cwd: root });
      execFileSync('git', ['add', '-A'], { cwd: root });
      const census = await takeCensus(root, { tests: ['**/*_spec.lua'], focus: [], ignore: [] });
      expect(census.stack.languages).toEqual([{ name: 'lua', files: 2, lines: 4 }]);
      expect(census.sourceFiles).toBe(1);
      expect(census.testFiles).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
