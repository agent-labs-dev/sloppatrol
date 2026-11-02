import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Stack } from '../census/index.js';

/** Shipped in the npm package next to `dist/`. */
const PLAYBOOK = fileURLToPath(new URL('../../playbook/', import.meta.url));
/** The lenses live in the skill, so an agent that installs only the skill reads the same set. */
const LENSES = fileURLToPath(new URL('../../skills/sloppatrol/references/lenses/', import.meta.url));

const CORE = ['principles', 'testing', 'smells', 'safety'];

/** The stack pages that apply: the main language, and any other with 5% of the lines or more. */
function stackPages(stack: Stack): string[] {
  const total = stack.languages.reduce((sum, l) => sum + l.lines, 0) || 1;
  const major = new Set(stack.languages.filter((l, i) => i === 0 || l.lines / total >= 0.05).map((l) => l.name));
  const pages = new Set<string>();
  const js = major.has('typescript') || major.has('javascript');
  if (js) pages.add('typescript');
  if (stack.frameworks.some((f) => ['react', 'react-native', 'expo', 'next', 'electron'].includes(f)))
    pages.add('react');
  if (js && stack.kinds.includes('backend')) pages.add('node-backend');
  for (const name of ['python', 'go', 'swift', 'kotlin', 'rust']) if (major.has(name)) pages.add(name);
  if (major.has('java')) pages.add('kotlin');
  return [...pages];
}

async function page(path: string): Promise<string | undefined> {
  return existsSync(path) ? (await readFile(path, 'utf8')).trim() : undefined;
}

/** The ids of the built-in lenses, sorted. */
export async function lensIds(): Promise<string[]> {
  return (await readdir(LENSES))
    .filter((name) => name.endsWith('.md'))
    .map((name) => name.slice(0, -3))
    .sort();
}

/** One built-in lens in full, or undefined for an unknown id. */
export async function lens(id: string): Promise<string | undefined> {
  return /^[a-z0-9-]+$/.test(id) ? page(join(LENSES, `${id}.md`)) : undefined;
}

/** The body of one `## <name>` section, as one line. */
function section(text: string, name: string): string {
  const body = text.split(`\n## ${name}\n`)[1]?.split('\n## ')[0] ?? '';
  return (
    body
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ') ?? ''
  );
}

/** One line per lens: the defect's first sentence and the safe move. */
async function lensIndex(): Promise<string> {
  const lines = [];
  for (const id of await lensIds()) {
    const text = (await lens(id)) ?? '';
    const defect = section(text, 'Defect').split(/(?<=[.:])\s/)[0];
    lines.push(`- **${id}**: ${defect} → ${section(text, 'Safe move')}`);
  }
  return `# Lenses\n\nEach lens in full also says what not to flag, how to judge a candidate and what to record; the surveyor reads one with \`get_lens\`.\n\n${lines.join('\n')}`;
}

/** The core pages and the lens index, then the stack pages: what every role must follow. */
export async function playbookFor(stack: Stack): Promise<string> {
  const paths = [
    ...CORE.map((name) => join(PLAYBOOK, `${name}.md`)),
    ...stackPages(stack).map((name) => join(PLAYBOOK, 'stacks', `${name}.md`)),
  ];
  const pages = (await Promise.all(paths.map(page))).filter((p): p is string => Boolean(p));
  pages.splice(CORE.length, 0, await lensIndex());
  return pages.join('\n\n---\n\n');
}
