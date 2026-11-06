import { describe, expect, it } from 'vitest';
import { playbookFor } from '../../playbook/index.js';

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
