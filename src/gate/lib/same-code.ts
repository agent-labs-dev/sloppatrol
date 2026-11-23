import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import ts from 'typescript';
import { git, tryGit } from '../../git/index.js';

const SCRIPT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PROSE = new Set(['.md', '.markdown', '.rst', '.txt', '.adoc']);
const LINE_TERMINATOR = /[\r\n\u2028\u2029]/;
const DIRECTIVE_COMMENT =
  /^\/\/\/|^\/\*!|@(?:jsx(?:Frag|ImportSource|Runtime)?|ts-(?:ignore|expect-error|nocheck|check)|flow|noflow|format|babel|vite-ignore|preserve|license|__PURE__|__NO_SIDE_EFFECTS__|__KEY__|__MANGLE_PROP__)\b|#(?:__PURE__|__NO_SIDE_EFFECTS__|__KEY__|__MANGLE_PROP__)\b|\b(?:webpack[A-Z]\w*|turbopack[A-Z]\w*|vite-ignore|sourceMappingURL=|sourceURL=|istanbul\s+ignore|(?:v8|c8)\s+ignore|node:coverage|biome-ignore|eslint-(?:disable|enable|env)|oxlint-disable)\b/;

/**
 * The file's tokens as the compiler parses them, each marked when a line break
 * comes before it, or nothing for a language without a parser here. Ordinary
 * comments drop out, while compiler/bundler directives and shebangs stay in;
 * any ECMA-262 line terminator inside trivia (LF, CR, LS, PS) still counts as
 * a line break for automatic semicolon insertion. String, template and JSX
 * text contents are kept byte for byte.
 */
function tokensOf(path: string, text: string): string[] | undefined {
  if (!SCRIPT.has(extname(path).toLowerCase())) return undefined;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const tokens: string[] = [];
  const shebang = ts.getShebang(text);
  if (shebang) tokens.push(`shebang:${shebang}`);
  let seenCodeToken = false;
  const seenComments = new Set<number>();
  const visit = (node: ts.Node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length === 0) {
      const fullStart = node.getFullStart();
      const start = node.getStart(source);
      const isJsxText = node.kind === ts.SyntaxKind.JsxText || node.kind === ts.SyntaxKind.JsxTextAllWhiteSpaces;
      if (!isJsxText) {
        const ranges = [
          ...(ts.getTrailingCommentRanges(text, fullStart) ?? []),
          ...(ts.getLeadingCommentRanges(text, fullStart) ?? []),
        ].sort((a, b) => a.pos - b.pos);
        for (const range of ranges) {
          if (range.end > start || seenComments.has(range.pos)) continue;
          seenComments.add(range.pos);
          const comment = text.slice(range.pos, range.end);
          if (DIRECTIVE_COMMENT.test(comment)) tokens.push(`directive:${comment}`);
        }
      }
      if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
      const breakBefore = seenCodeToken && !isJsxText && LINE_TERMINATOR.test(text.slice(fullStart, start));
      const tokenText = isJsxText ? text.slice(node.pos, node.end) : node.getText(source);
      tokens.push(`${node.kind}:${breakBefore ? '1' : '0'}:${tokenText}`);
      seenCodeToken = true;
    }
    for (const child of children) visit(child);
  };
  visit(source);
  return tokens;
}

function sameTokens(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((token, index) => token === after[index]);
}

/**
 * True when every code file the change touches parses to the same tokens at
 * base and in the worktree: the change edited comments and prose only, so no
 * behaviour can differ. Only languages the TypeScript compiler parses qualify;
 * a hand lexer can mistake a heredoc, a regex or a build directive for a
 * comment. A new, deleted or renamed code file, or any other language, makes
 * it false, and the usual planted-bug proof runs instead.
 */
export async function codeUnchanged(worktree: string, baseSha: string): Promise<boolean> {
  const status = await git(worktree, ['diff', '--name-status', '--no-renames', baseSha, 'HEAD']);
  const changed = status
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t'))
    .filter(([, path]) => path && !PROSE.has(extname(path).toLowerCase()));
  if (!changed.length) return false;
  for (const [kind, path] of changed) {
    if (kind !== 'M' || !path) return false;
    const base = await tryGit(worktree, ['show', `${baseSha}:${path}`]);
    const head = await readFile(join(worktree, path), 'utf8').catch(() => undefined);
    if (base === undefined || head === undefined) return false;
    const before = tokensOf(path, base);
    const after = tokensOf(path, head);
    if (before === undefined || after === undefined || !sameTokens(before, after)) return false;
  }
  return true;
}
