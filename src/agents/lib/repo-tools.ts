import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { tryGit } from '../../git/index.js';
import { optionalStr, str, tool } from './schema.js';
import type { Tool } from './types.js';

function inside(root: string, path: string): string {
  const full = resolve(root, path);
  if (relative(root, full).startsWith('..')) throw new Error(`${path} is outside the repository`);
  return full;
}

/**
 * Read-only repository tools. A CLI agent has its own file tools; these let
 * a model runtime read the code too, and keep every role inside the repo.
 */
export function repoTools(root: string): Tool[] {
  return [
    tool(
      'list_files',
      'List tracked files in the repository. Filter by a path substring, e.g. "routes" or ".tsx".',
      { filter: { type: 'string', description: 'Substring of the path. Optional.' } },
      [],
      async (input) => {
        const filter = optionalStr(input, 'filter');
        const files = ((await tryGit(root, ['ls-files'])) ?? '')
          .split('\n')
          .filter((file) => !filter || file.includes(filter));
        return {
          text: files.slice(0, 400).join('\n') + (files.length > 400 ? `\n... ${files.length - 400} more` : ''),
        };
      },
    ),
    tool(
      'read_file',
      'Read a file of the repository, with line numbers.',
      {
        path: { type: 'string', description: 'Path relative to the repository root.' },
        start: { type: 'number', description: 'First line, 1-based. Default 1.' },
        lines: { type: 'number', description: 'How many lines. Default 250.' },
      },
      ['path'],
      async (input) => {
        const text = await readFile(inside(root, str(input, 'path')), 'utf8');
        const start = Math.max(1, Number(input.start ?? 1));
        const count = Math.min(1000, Number(input.lines ?? 250));
        const all = text.split('\n');
        const body = all
          .slice(start - 1, start - 1 + count)
          .map((line, index) => `${start + index}\t${line}`)
          .join('\n');
        return { text: `${body}\n(${all.length} lines in the file)` };
      },
    ),
    tool(
      'search',
      'Search the repository with git grep (a regular expression). Returns file:line:text.',
      { pattern: { type: 'string', description: 'The regular expression.' } },
      ['pattern'],
      async (input) => {
        const out = (await tryGit(root, ['grep', '-n', '-I', '-E', '--max-count=20', str(input, 'pattern')])) ?? '';
        const lines = out.split('\n').filter(Boolean);
        return { text: lines.slice(0, 200).join('\n') || 'No match.' };
      },
    ),
  ];
}

/**
 * File edits for a refactorer on the model runtime. A CLI agent has its own
 * edit tools; these keep a model inside the worktree.
 */
export function editTools(root: string): Tool[] {
  return [
    tool(
      'edit_file',
      'Replace one exact, unique piece of text in a file.',
      {
        path: { type: 'string', description: 'Path relative to the repository root.' },
        old_text: { type: 'string', description: 'The exact text to replace. It must occur once.' },
        new_text: { type: 'string', description: 'The replacement.' },
      },
      ['path', 'old_text', 'new_text'],
      async (input) => {
        const file = inside(root, str(input, 'path'));
        const text = await readFile(file, 'utf8');
        const old = str(input, 'old_text');
        const at = text.indexOf(old);
        if (at < 0 || text.indexOf(old, at + 1) >= 0)
          return { text: 'old_text must occur exactly once.', isError: true };
        await writeFile(file, text.slice(0, at) + String(input.new_text ?? '') + text.slice(at + old.length));
        return { text: 'Edited.' };
      },
    ),
    tool(
      'write_file',
      'Create or overwrite a file.',
      {
        path: { type: 'string', description: 'Path relative to the repository root.' },
        content: { type: 'string', description: 'The whole file.' },
      },
      ['path', 'content'],
      async (input) => {
        const file = inside(root, str(input, 'path'));
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, String(input.content ?? ''));
        return { text: 'Written.' };
      },
    ),
  ];
}
