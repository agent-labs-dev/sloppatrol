import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/** The repo's own rules, and the files they came from (for the proof). */
export type RepoRules = { text: string; sources: string[] };

/** Agent guides, read in every folder from the repo root down to a changed file. */
const AGENT_GUIDES = ['AGENTS.md', 'CLAUDE.md', '.claude/CLAUDE.md'];
/** Other written rules, read at the repo root only. */
const ROOT_GUIDES = ['CONTRIBUTING.md', 'CODING_STANDARDS.md', 'GLOSSARY.md', 'CONTEXT.md'];
/** A guide this long is still read whole; past it, the agent gets a note that it was cut. */
const MAX_FILE = 100_000;
const IMPORT = /^@(\S+)\s*$/;

/**
 * Reads one guide and the files it imports with `@path` lines, the way
 * Claude Code does, so a CLAUDE.md that only says `@AGENTS.md` is not lost.
 */
async function readGuide(
  file: string,
  root: string,
  seen: Set<string>,
  depth = 0,
): Promise<{ path: string; body: string }[]> {
  const full = resolve(file);
  if (seen.has(full) || !existsSync(full) || depth > 4) return [];
  seen.add(full);
  const text = await readFile(full, 'utf8');
  const own = text
    .split('\n')
    .filter((line) => !IMPORT.test(line))
    .join('\n')
    .trim();
  const imported: { path: string; body: string }[] = [];
  for (const line of text.split('\n')) {
    const target = IMPORT.exec(line)?.[1];
    if (target)
      imported.push(...(await readGuide(resolve(dirname(full), target.replace(/^~\//, '')), root, seen, depth + 1)));
  }
  const body =
    own.length > MAX_FILE ? `${own.slice(0, MAX_FILE)}\n\n(cut: the file has ${own.length} characters)` : own;
  return [...(body ? [{ path: relative(root, full), body }] : []), ...imported];
}

/** The folders from the repo root down to each file, root first. */
function foldersOn(paths: string[]): string[] {
  const folders = new Set<string>(['.']);
  for (const path of paths) {
    const parts = dirname(path)
      .split('/')
      .filter((p) => p && p !== '.');
    for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  }
  return [...folders].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
}

/**
 * The repo's own rules: Sloppatrol's instructions, every AGENTS.md and
 * CLAUDE.md from the root down to the files in `near`, the contributor
 * guides, and the decision records. They win over the playbook.
 */
export async function readRepoRules(root: string, configDir: string, near: string[] = []): Promise<RepoRules> {
  const seen = new Set<string>();
  const guides: { path: string; body: string }[] = [];
  guides.push(...(await readGuide(join(configDir, 'instructions.md'), root, seen)));
  for (const folder of foldersOn(near))
    for (const name of AGENT_GUIDES) guides.push(...(await readGuide(join(root, folder, name), root, seen)));
  for (const name of ROOT_GUIDES) guides.push(...(await readGuide(join(root, name), root, seen)));
  const sections = guides.map((g) => `## ${g.path}\n\n${g.body}`);
  for (const folder of ['docs/adr', 'docs/decisions', 'adr']) {
    const dir = join(root, folder);
    if (!existsSync(dir)) continue;
    const records = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
    if (records.length)
      sections.push(
        `## Decision records in ${folder}/ (read one before you change what it decided)\n\n${records.map((r) => `- ${r}`).join('\n')}`,
      );
  }
  const sources = guides.map((g) => g.path);
  if (!sections.length)
    return {
      text: '# The repo has no written rules: follow the playbook and the style of the code around you.',
      sources,
    };
  return {
    text: `# The repo's own rules\n\nThey win over the playbook. Every change must respect them: setup, commands, conventions, and what not to touch.\n\n${sections.join('\n\n')}`,
    sources,
  };
}
