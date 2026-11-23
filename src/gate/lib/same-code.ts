import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import ts from 'typescript';
import { git, tryGit } from '../../git/index.js';

const SCRIPT = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']);
const PROSE = new Set(['.md', '.markdown', '.rst', '.txt', '.adoc']);

/**
 * The file's tokens as the compiler parses them, each marked when a line break
 * comes before it, or nothing for a language without a parser here. Comments
 * are trivia, so they drop out; a block comment that spans lines still counts
 * as a line break, because automatic semicolon insertion reads it as one.
 * String and template contents are tokens, so every byte of them counts.
 */
function tokensOf(path: string, text: string): string | undefined {
  if (!SCRIPT.has(extname(path).toLowerCase())) return undefined;
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const tokens: string[] = [];
  const visit = (node: ts.Node) => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length === 0) {
      const breakBefore =
        tokens.length > 0 &&
        node.kind !== ts.SyntaxKind.EndOfFileToken &&
        text.slice(node.getFullStart(), node.getStart(source)).includes('\n');
      tokens.push(`${breakBefore ? '\n' : ' '}${node.getText(source)}`);
    }
    for (const child of children) visit(child);
  };
  visit(source);
  return tokens.join('');
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
    if (before === undefined || before !== tokensOf(path, head)) return false;
  }
  return true;
}
