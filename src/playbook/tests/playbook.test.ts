import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { lens, lensIds, playbookFor } from '../../playbook/index.js';

describe('the playbook', () => {
  it('holds the core pages and the page of the main language', async () => {
    const text = await playbookFor({
      languages: [{ name: 'go', files: 40, lines: 4000 }],
      frameworks: [],
      kinds: ['backend'],
    });
    for (const title of ['# Principles', '# Testing', '# Smells', '# Safety', '# Go']) expect(text).toContain(title);
  });

  it('leaves out a language with a small share of the lines', async () => {
    const text = await playbookFor({
      languages: [
        { name: 'python', files: 6731, lines: 673100 },
        { name: 'typescript', files: 38, lines: 3800 },
      ],
      frameworks: ['fastapi'],
      kinds: ['backend'],
    });
    expect(text).toContain('# Python');
    expect(text).not.toContain('# TypeScript');
    expect(text).not.toContain('# Node');
  });

  it('adds the client page for a React app', async () => {
    const text = await playbookFor({
      languages: [{ name: 'typescript', files: 90, lines: 9000 }],
      frameworks: ['react'],
      kinds: ['client'],
    });
    expect(text).toContain('# TypeScript');
    expect(text).toContain('# React');
  });
});

describe('the lenses', () => {
  it('are the built-in lens ids the gate registers, each with all five sections', async () => {
    const gate = readFileSync(new URL('../../../skills/sloppatrol/scripts/gate.py', import.meta.url), 'utf8');
    const listed = /BUILTIN_LENSES[^(]*\(([\s\S]*?)\.split\(\)/.exec(gate)?.[1] ?? '';
    const registered = [...listed.matchAll(/"([^"]*)"/g)]
      .flatMap((m) => (m[1] ?? '').split(/\s+/))
      .filter(Boolean)
      .sort();
    expect(await lensIds()).toEqual(registered);
    for (const id of registered) {
      const text = (await lens(id)) ?? '';
      expect(text.startsWith(`# ${id}\n`)).toBe(true);
      for (const name of ['Defect', 'Do not flag', 'Judgment', 'Output', 'Safe move'])
        expect(text, `${id}: ${name}`).toContain(`\n## ${name}\n`);
    }
  });

  it('are listed in the playbook with their safe move', async () => {
    const text = await playbookFor({ languages: [{ name: 'go', files: 1, lines: 10 }], frameworks: [], kinds: [] });
    expect(text).toContain('- **dead-code**: Code, files, dependencies');
    expect(text).toContain('→ Import from the module');
  });
});
