import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tryGit } from '../../git/index.js';

export type FileSize = { path: string; lines: number };
export type MockUse = { path: string; count: number; sample: string };
export type Churn = { path: string; commits: number };

/**
 * Mocking libraries and patches of the team's own code. Each hit is a
 * candidate for a fake injected through a seam (playbook/testing.md).
 */
const MOCK = new RegExp(
  [
    String.raw`\b(jest|vi)\.(mock|doMock|spyOn)\(`,
    String.raw`\bsinon\.(stub|mock|spy|replace)\b`,
    String.raw`\bunittest\.mock\b|\bfrom mock import\b|@(mock\.)?patch(\.object)?\(|\bmocker\.patch\b|\bmonkeypatch\.setattr\b`,
    String.raw`\bgomock\b|\bmockery\b|\btestify/mock\b`,
    String.raw`\bMockito\b|\bmockk\b|@MockBean\b|@Mock\b`,
    String.raw`\bmockall\b|#\[automock\]`,
  ].join('|'),
  'g',
);

const MAX_BYTES = 400_000;

async function text(root: string, path: string): Promise<string | undefined> {
  try {
    const body = await readFile(join(root, path), 'utf8');
    return body.length > MAX_BYTES ? undefined : body;
  } catch {
    return undefined;
  }
}

export async function measureFiles(
  root: string,
  sources: string[],
  tests: string[],
): Promise<{ largest: FileSize[]; mocks: MockUse[] }> {
  const sizes: FileSize[] = [];
  for (const path of sources) {
    const body = await text(root, path);
    if (body !== undefined) sizes.push({ path, lines: body.split('\n').length });
  }
  const mocks: MockUse[] = [];
  for (const path of tests) {
    const body = await text(root, path);
    const hits = body?.match(MOCK);
    if (!body || !hits) continue;
    const line = body.split('\n').find((l) => new RegExp(MOCK.source).test(l)) ?? '';
    mocks.push({ path, count: hits.length, sample: line.trim().slice(0, 160) });
  }
  return {
    largest: sizes.sort((a, b) => b.lines - a.lines).slice(0, 25),
    mocks: mocks.sort((a, b) => b.count - a.count).slice(0, 25),
  };
}

/** The files the last commits touched most. Refactors pay off where code changes. */
export async function churn(root: string, keep: (path: string) => boolean): Promise<Churn[]> {
  const log = (await tryGit(root, ['log', '--max-count=300', '--name-only', '--format='])) ?? '';
  const counts = new Map<string, number>();
  for (const path of log.split('\n').filter(Boolean)) {
    if (keep(path)) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts]
    .map(([path, commits]) => ({ path, commits }))
    .sort((a, b) => b.commits - a.commits)
    .slice(0, 60);
}
