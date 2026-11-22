import { describe, expect, it } from 'vitest';
import { playbookFor } from '../../playbook/index.js';

const KEEP = { comments: { ban: false } };

describe('the playbook', () => {
  it('holds the core pages and the page of the main language', async () => {
    const text = await playbookFor(
      {
        languages: [{ name: 'go', files: 40, lines: 4000 }],
        frameworks: [],
        kinds: ['backend'],
      },
      KEEP,
    );
    for (const title of ['# Principles', '# Testing', '# Smells', '# Safety', '# Go']) expect(text).toContain(title);
  });

  it('leaves out a language with a small share of the lines', async () => {
    const text = await playbookFor(
      {
        languages: [
          { name: 'python', files: 6731, lines: 673100 },
          { name: 'typescript', files: 38, lines: 3800 },
        ],
        frameworks: ['fastapi'],
        kinds: ['backend'],
      },
      KEEP,
    );
    expect(text).toContain('# Python');
    expect(text).not.toContain('# TypeScript');
    expect(text).not.toContain('# Node');
  });

  it('adds the comments page only when the repo bans comments', async () => {
    const stack = { languages: [{ name: 'go', files: 40, lines: 4000 }], frameworks: [], kinds: ['backend' as const] };
    expect(await playbookFor(stack, { comments: { ban: false } })).not.toContain('# Comments');
    expect(await playbookFor(stack, { comments: { ban: true } })).toContain('# Comments');
  });

  it('adds the client page for a React app', async () => {
    const text = await playbookFor(
      {
        languages: [{ name: 'typescript', files: 90, lines: 9000 }],
        frameworks: ['react'],
        kinds: ['client'],
      },
      KEEP,
    );
    expect(text).toContain('# TypeScript');
    expect(text).toContain('# React');
  });
});
