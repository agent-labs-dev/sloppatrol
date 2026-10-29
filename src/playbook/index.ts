import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Stack } from '../census/index.js';

/** Shipped in the npm package next to `dist/`. */
const PLAYBOOK = fileURLToPath(new URL('../../playbook/', import.meta.url));

const CORE = ['principles', 'testing', 'smells', 'safety'];

/** The stack pages that apply: the main language, and any other with 5% of the files or more. */
function stackPages(stack: Stack): string[] {
  const total = stack.languages.reduce((sum, l) => sum + l.files, 0) || 1;
  const major = new Set(stack.languages.filter((l, i) => i === 0 || l.files / total >= 0.05).map((l) => l.name));
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

/** The core pages, then the stack pages: what every role must follow. */
export async function playbookFor(stack: Stack): Promise<string> {
  const paths = [
    ...CORE.map((name) => join(PLAYBOOK, `${name}.md`)),
    ...stackPages(stack).map((name) => join(PLAYBOOK, 'stacks', `${name}.md`)),
  ];
  const pages = await Promise.all(paths.map(page));
  return pages.filter(Boolean).join('\n\n---\n\n');
}
