import { createHash } from 'node:crypto';
import type { Mutation } from './proof.js';

/**
 * One planted bug for a source refactor: the same edit to the same line of
 * code, once in the base and once in the refactor. A refactor must not let a
 * bug the tests caught on the base slip past them after.
 */
type HeldMutant = { before: Mutation; after: Mutation };

type FileText = { path: string; text: string };

/** Small edits a test suite that pins a line's behaviour should catch, most telling first. */
const OPERATORS: [pattern: RegExp, replace: string, why: string][] = [
  [/ === /, ' !== ', 'equality flipped'],
  [/ !== /, ' === ', 'inequality flipped'],
  [/ == /, ' != ', 'equality flipped'],
  [/ != /, ' == ', 'inequality flipped'],
  [/ <= /, ' < ', 'boundary moved'],
  [/ >= /, ' > ', 'boundary moved'],
  [/ < /, ' <= ', 'boundary moved'],
  [/ > /, ' >= ', 'boundary moved'],
  [/ && /, ' || ', 'condition widened'],
  [/ \|\| /, ' && ', 'condition narrowed'],
  [/ and /, ' or ', 'condition widened'],
  [/ or /, ' and ', 'condition narrowed'],
  [/\btrue\b/, 'false', 'constant flipped'],
  [/\bfalse\b/, 'true', 'constant flipped'],
  [/\bTrue\b/, 'False', 'constant flipped'],
  [/\bFalse\b/, 'True', 'constant flipped'],
  [/ \+ /, ' - ', 'arithmetic changed'],
  [/ - /, ' + ', 'arithmetic changed'],
  [/ \* /, ' / ', 'arithmetic changed'],
];

const COMMENT = /^(\/\/|\/\*|\*|#|--|"""|''')/;

/** The first operator outside a string literal, judged by the quotes before it. */
function mutate(line: string, path: string): { line: string; why: string } | undefined {
  for (const [pattern, operator, why] of OPERATORS) {
    // Lua writes inequality as ~=, and != does not load.
    const replace = path.endsWith('.lua') && operator === ' != ' ? ' ~= ' : operator;
    const at = line.search(pattern);
    if (at === -1) continue;
    const before = line.slice(0, at);
    if ([`'`, `"`, '`'].some((q) => before.split(q).length % 2 === 0)) continue;
    return { line: line.replace(pattern, replace), why };
  }
  return undefined;
}

function linesOf(files: FileText[]): Map<string, { path: string; raw: string; text: string }[]> {
  const index = new Map<string, { path: string; raw: string; text: string }[]>();
  for (const file of files)
    for (const raw of file.text.split('\n')) {
      const key = raw.trim();
      if (key) index.set(key, [...(index.get(key) ?? []), { path: file.path, raw, text: file.text }]);
    }
  return index;
}

/**
 * Up to `limit` planted bugs on lines a source refactor kept: each line is
 * once in the changed files before and once after, and once in its file, so
 * the edit lands on the same code both times. Lines that moved to another
 * file come first; the rest follow in a stable order spread over the change.
 */
export function heldMutants(before: FileText[], after: FileText[], limit: number): HeldMutant[] {
  const was = linesOf(before);
  const is = linesOf(after);
  const unique = (raw: string, text: string) => text.split(raw).length === 2;
  const found: (HeldMutant & { moved: boolean; order: string })[] = [];
  for (const [key, olds] of was) {
    const news = is.get(key);
    if (olds.length !== 1 || news?.length !== 1 || COMMENT.test(key)) continue;
    const [old, now] = [olds[0]!, news[0]!];
    const edit = mutate(key, old.path);
    if (!edit || !unique(old.raw, old.text) || !unique(now.raw, now.text)) continue;
    const plant = (at: { path: string; raw: string }): Mutation => ({
      file: at.path,
      find: at.raw,
      replace: at.raw.replace(key, () => edit.line),
      why: edit.why,
    });
    found.push({
      before: plant(old),
      after: plant(now),
      moved: old.path !== now.path,
      order: createHash('sha256').update(key).digest('hex'),
    });
  }
  return found
    .sort((a, b) => Number(b.moved) - Number(a.moved) || a.order.localeCompare(b.order))
    .slice(0, limit)
    .map(({ before, after }) => ({ before, after }));
}
