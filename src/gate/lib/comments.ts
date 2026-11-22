import { extname } from 'node:path';
import ts from 'typescript';

const NOT_COUNTED = /\bTODO\b|eslint-disable|biome-ignore|@ts-|# type: ignore|# noqa|nolint|@license|SPDX-/;
const SCRIPT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);
const HASH = new Set(['.py', '.rb', '.sh', '.bash', '.yaml', '.yml', '.toml', '.r', '.pl']);
const SLASH = new Set([
  '.java',
  '.kt',
  '.kts',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.go',
  '.rs',
  '.swift',
  '.php',
  '.scala',
  '.dart',
  '.css',
  '.scss',
]);

export function commentLines(path: string, text: string): number {
  const extension = extname(path).toLowerCase();
  const ranges = new Map<number, number>();
  const jsxText: { start: number; end: number }[] = [];
  if (SCRIPT.has(extension)) {
    const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
    const add = (pos: number, end: number) => {
      ranges.set(pos, end);
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) jsxText.push({ start: node.pos, end: node.end });
      if (!ts.isJsxText(node)) {
        ts.forEachLeadingCommentRange(text, node.pos, add);
        ts.forEachTrailingCommentRange(text, node.end, add);
      }
      for (const child of node.getChildren(source)) visit(child);
    };
    visit(source);
  } else if (HASH.has(extension) || SLASH.has(extension) || extension === '.sql' || extension === '.lua') {
    let quote = '';
    const shell = extension === '.sh' || extension === '.bash';
    for (let i = 0; i < text.length; i++) {
      if (quote) {
        const raw = (extension === '.go' && quote === '`') || (shell && quote === "'");
        if (!raw && text[i] === '\\') i++;
        else if (text.startsWith(quote, i)) {
          i += quote.length - 1;
          quote = '';
        }
      } else if (shell && text[i] === '\\') {
        i++;
      } else if (extension === '.rs' && /^r(#+)?"/.test(text.slice(i))) {
        const delimiter = /^r(#+)?"/.exec(text.slice(i))![0];
        const close = `"${delimiter.slice(1, -1)}`;
        const end = text.indexOf(close, i + delimiter.length);
        i = end < 0 ? text.length : end + close.length - 1;
      } else if (
        extension === '.rs' &&
        text[i] === "'" &&
        !/^'(?:[^'\\\r\n]|\\(?:u\{[\da-fA-F]+\}|x[\da-fA-F]{2}|.))'/u.test(text.slice(i))
      ) {
        // A lifetime's apostrophe does not open a string.
      } else if (extension === '.lua' && /^(?:--)?\[=*\[/.test(text.slice(i))) {
        const delimiter = /^(--)?\[(=*)\[/.exec(text.slice(i))!;
        const close = `]${delimiter[2]}]`;
        const end = text.indexOf(close, i + delimiter[0].length);
        const after = end < 0 ? text.length : end + close.length;
        if (delimiter[1]) ranges.set(i, after);
        i = after - 1;
      } else if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
        quote = extension === '.py' && text.startsWith(text[i]!.repeat(3), i) ? text[i]!.repeat(3) : text[i]!;
        i += quote.length - 1;
      } else if (
        (HASH.has(extension) &&
          text[i] === '#' &&
          text[i + 1] !== '!' &&
          (!shell || i === 0 || /[\s;&|()]/.test(text[i - 1]!))) ||
        (SLASH.has(extension) && text.startsWith('//', i)) ||
        ((extension === '.sql' || extension === '.lua') && text.startsWith('--', i))
      ) {
        const end = text.indexOf('\n', i);
        ranges.set(i, end < 0 ? text.length : end);
        i = end < 0 ? text.length : end;
      } else if ((SLASH.has(extension) || extension === '.sql') && text.startsWith('/*', i)) {
        const end = text.indexOf('*/', i + 2);
        ranges.set(i, end < 0 ? text.length : end + 2);
        i = end < 0 ? text.length : end + 1;
      }
    }
  }
  const lines = new Set<number>();
  for (const [start, end] of ranges) {
    if (jsxText.some((range) => start >= range.start && start < range.end)) continue;
    const first = text.slice(0, start).split('\n').length;
    text
      .slice(start, end)
      .split('\n')
      .forEach((line, offset) => {
        if (!NOT_COUNTED.test(line)) lines.add(first + offset);
      });
  }
  return lines.size;
}
