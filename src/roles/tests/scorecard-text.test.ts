import { describe, expect, it } from 'vitest';
import type { Scorecard } from '../../domain/index.js';
import { scorecardMarkdown } from '../index.js';

describe('scorecardMarkdown', () => {
  it("shows the assessor's whole evidence, however long", () => {
    const evidence = `lines 1-3: one concept with one small interface. ${'More reasoning. '.repeat(20)}Not 4: the reason ends here.`;
    const scorecard: Scorecard = {
      sha: 'abcdef0123456789',
      at: '2026-11-16T00:00:00.000Z',
      rubric: 'r1',
      units: [
        {
          path: 'src/a.ts',
          contentHash: 'h',
          rubric: 'r1',
          signals: { lines: 3, maxNesting: 1, commentLines: 0, mocks: 0, suppressions: 0 },
          scores: { modularity: { score: 3, evidence } },
        },
      ],
      means: { modularity: 3 },
      coverage: { files: 1, totalFiles: 1, lines: 3, totalLines: 3 },
    };
    expect(evidence.length).toBeGreaterThan(200);
    expect(scorecardMarkdown(scorecard)).toContain(`(${evidence})`);
  });
});
