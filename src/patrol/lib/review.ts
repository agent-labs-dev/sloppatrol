import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { LoadedConfig } from '../../config/index.js';
import type { UnitScores } from '../../domain/index.js';
import { checkout, git, removeWorktree, resolveRef, tryGit } from '../../git/index.js';
import { meanScores, overallPercent } from '../../metrics/index.js';
import { roleContext } from './base.js';
import type { PatrolDeps } from './deps.js';
import { exclusive } from './lock.js';
import { scoreFiles } from './scorecard.js';

/** A file that loses this many points or more (0-100) is a regression: `sloppatrol review` exits 1. */
const REGRESSION_POINTS = 10;

/** What `sloppatrol review <target>` reviews: a pull request by number or URL, or a git ref. */
export type ReviewTarget = { kind: 'pr'; number: number } | { kind: 'ref'; ref: string };

/** `123`, `#123` and a GitHub pull request URL name a pull request. Anything else is a git ref. */
export function reviewTarget(arg: string): ReviewTarget {
  const number =
    /^#?(\d+)$/.exec(arg)?.[1] ?? /^https?:\/\/[^/]+\/[^/]+\/[^/]+\/pull\/(\d+)(?:[/?#].*)?$/.exec(arg)?.[1];
  return number ? { kind: 'pr', number: Number(number) } : { kind: 'ref', ref: arg };
}

type FileReview = {
  /** The path at the head. */
  path: string;
  /** The path at the merge base, when the change renamed the file. */
  renamedFrom?: string;
  /** The change adds the file: it has no base score. */
  added: boolean;
  /** 0-100. Absent for an added file, or when the assessor gave no score. */
  base?: number;
  /** 0-100. Absent when the assessor gave no score. */
  head?: number;
  delta?: number;
};

export type Review = {
  head: { ref: string; sha: string };
  base: { ref: string; sha: string };
  mergeBase: string;
  /** Worst regression first, then new files from the lowest score up. */
  files: FileReview[];
  /** Line-weighted over the changed files scored on that side: the head includes added files. */
  total: { base?: number; head?: number };
  /** Files in scope that the change deletes: they have no head score. */
  deleted: number;
};

const percentOf = (unit: UnitScores | undefined) => (unit ? overallPercent(meanScores([unit])) : undefined);

/** A pull request's head may be on GitHub only: fetch it. */
async function prHead(source: string, number: number, sha: string): Promise<string> {
  if ((await tryGit(source, ['cat-file', '-e', `${sha}^{commit}`])) === undefined)
    await tryGit(source, ['fetch', '--quiet', 'origin', `pull/${number}/head`]);
  const found = await tryGit(source, ['rev-parse', '--verify', `${sha}^{commit}`]);
  if (!found) throw new Error(`Cannot fetch the head ${sha.slice(0, 10)} of pull request #${number}.`);
  return found;
}

async function resolveOrThrow(source: string, refs: string[]): Promise<{ ref: string; sha: string }> {
  for (const ref of refs) {
    const sha = await resolveRef(source, ref);
    if (sha) return { ref, sha };
  }
  throw new Error(`Cannot resolve ${refs.join(' or ')} in ${source}.`);
}

/** The changed paths, from `git diff --name-status`: `[head path, base path]` pairs, and the deleted paths. */
async function changedPaths(
  source: string,
  from: string,
  to: string,
): Promise<{ pairs: [string, string][]; deleted: string[] }> {
  const out = await git(source, ['diff', '--name-status', '-M', '-z', from, to]);
  const parts = out.split('\0').filter(Boolean);
  const pairs: [string, string][] = [];
  const deleted: string[] = [];
  for (let i = 0; i < parts.length; ) {
    const status = parts[i++]!;
    if (status.startsWith('R') || status.startsWith('C')) {
      const old = parts[i++]!;
      pairs.push([parts[i++]!, old]);
    } else if (status === 'D') deleted.push(parts[i++]!);
    else {
      const path = parts[i++]!;
      pairs.push([path, path]);
    }
  }
  return { pairs, deleted };
}

/** The changed files ordered for a reader: worst regression first, then new files from the lowest score up. */
function byRegression(a: FileReview, b: FileReview): number {
  const rank = (f: FileReview) => f.delta ?? (f.head === undefined ? Number.POSITIVE_INFINITY : Number.MAX_VALUE);
  return rank(a) - rank(b) || (a.head ?? 101) - (b.head ?? 101) || a.path.localeCompare(b.path);
}

/**
 * Scores the files a branch or pull request changes, at its head and at its
 * merge base with `base`, through the same cache as `sloppatrol score`. It
 * checks out both commits away from the user's working tree, changes no
 * code, runs no checks, and posts nothing.
 */
export function reviewNow(
  loaded: LoadedConfig,
  deps: PatrolDeps,
  input: { target: ReviewTarget; base?: string },
): Promise<Review> {
  return exclusive(loaded, deps, async () => {
    const { source, config } = loaded;
    let head: { ref: string; sha: string };
    let baseRefs: string[];
    if (input.target.kind === 'pr') {
      const pr = await deps.github.pullRequestRefs(input.target.number);
      head = {
        ref: `#${input.target.number} (${pr.headRef})`,
        sha: await prHead(source, input.target.number, pr.headSha),
      };
      baseRefs = [`origin/${pr.baseRef}`, pr.baseRef];
    } else {
      head = await resolveOrThrow(source, [input.target.ref]);
      baseRefs = [config.patrol.pull];
    }
    const base = await resolveOrThrow(source, input.base ? [input.base] : baseRefs);
    const mergeBase = await tryGit(source, ['merge-base', base.sha, head.sha]);
    if (!mergeBase) throw new Error(`${head.ref} and ${base.ref} have no common commit.`);
    const { pairs, deleted } = await changedPaths(source, mergeBase, head.sha);
    const review: Review = { head, base, mergeBase, files: [], total: {}, deleted: 0 };
    if (!pairs.length && !deleted.length) return review;

    // A review that was stopped (Ctrl-C) left its checkouts behind.
    const root = deps.store.path('reviews');
    if (existsSync(root)) for (const name of await readdir(root)) await removeWorktree(source, join(root, name));
    const dirs: string[] = [];
    try {
      const scoreAt = async (sha: string, paths: string[]) => {
        const dir = join(root, sha.slice(0, 12));
        if (!dirs.includes(dir)) {
          dirs.push(dir);
          await checkout(source, dir, sha);
        }
        const { ctx, census } = await roleContext(loaded, deps, { sha, dir });
        // Only the files a full scorecard would score: in scope, not ignored.
        const inScope = new Set(census.files);
        const { scored, files } = await scoreFiles(ctx, {
          dir,
          sha,
          census,
          paths: paths.filter((p) => inScope.has(p)),
          budget: Number.POSITIVE_INFINITY,
        });
        return { scored, inScope, read: new Set(files.map((f) => f.path)) };
      };
      const atHead = await scoreAt(
        head.sha,
        pairs.map(([path]) => path),
      );
      const kept = pairs.filter(([path]) => atHead.inScope.has(path));
      const atBase = await scoreAt(
        mergeBase,
        kept.map(([, old]) => old),
      );
      const headUnit = new Map(atHead.scored.map((u) => [u.path, u]));
      const baseUnit = new Map(atBase.scored.map((u) => [u.path, u]));
      const files = kept.map(([path, old]): FileReview => {
        const before = percentOf(baseUnit.get(old));
        const after = percentOf(headUnit.get(path));
        return {
          path,
          ...(old !== path ? { renamedFrom: old } : {}),
          added: !atBase.read.has(old),
          base: before,
          head: after,
          delta: before !== undefined && after !== undefined ? after - before : undefined,
        };
      });
      return {
        ...review,
        files: files.sort(byRegression),
        total: {
          base: overallPercent(meanScores([...baseUnit.values()])),
          head: overallPercent(meanScores([...headUnit.values()])),
        },
        deleted: deleted.filter((p) => atBase.inScope.has(p)).length,
      };
    } finally {
      for (const dir of dirs) await removeWorktree(source, dir);
    }
  });
}

/** True when a file lost `REGRESSION_POINTS` or more. */
export function regressed(review: Review): boolean {
  return review.files.some((f) => f.delta !== undefined && f.delta <= -REGRESSION_POINTS);
}

const pct = (n: number | undefined) => (n === undefined ? '–' : `${n}%`);
const signed = (n: number | undefined) => (n === undefined ? '' : n > 0 ? `+${n}` : String(n));

/** The review for a person: one row per changed file, and the total. */
export function reviewMarkdown(review: Review): string {
  const { head, base, files } = review;
  const lines = [
    `# Review of ${head.ref} at ${head.sha.slice(0, 10)}, against ${base.ref} at the merge base ${review.mergeBase.slice(0, 10)}`,
  ];
  if (!files.length) {
    lines.push('No changed file is in scope. Nothing to score.');
    return lines.join('\n\n');
  }
  const { total } = review;
  const totalDelta = total.base !== undefined && total.head !== undefined ? total.head - total.base : undefined;
  lines.push(
    `${files.length} changed file(s). Total: ${pct(total.base)} → ${pct(total.head)}${totalDelta === undefined ? '' : ` (${signed(totalDelta)})`}.`,
  );
  lines.push(
    [
      '| File | Base | Head | Change |',
      '| --- | ---: | ---: | ---: |',
      ...files.map((f) => {
        const name = f.renamedFrom ? `\`${f.renamedFrom}\` → \`${f.path}\`` : `\`${f.path}\``;
        return `| ${name} | ${f.added ? 'new' : pct(f.base)} | ${pct(f.head)} | ${signed(f.delta)} |`;
      }),
    ].join('\n'),
  );
  if (review.deleted) lines.push(`${review.deleted} deleted file(s) are not scored.`);
  lines.push(
    regressed(review)
      ? `A file lost ${REGRESSION_POINTS} points or more.`
      : `No file lost ${REGRESSION_POINTS} points or more.`,
  );
  return lines.join('\n\n');
}
