import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

export type Stack = {
  /** Languages by file count, most first. */
  languages: { name: string; files: number }[];
  frameworks: string[];
  /** What the project is: it decides which playbook pages apply. */
  kinds: ('client' | 'backend' | 'cli' | 'library')[];
};

const LANGUAGES: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.java': 'java',
  '.rb': 'ruby',
  '.cs': 'csharp',
};

export function languageOf(path: string): string | undefined {
  return LANGUAGES[extname(path)];
}

const CLIENT = ['react', 'react-native', 'expo', 'next', 'vue', 'svelte', '@sveltejs/kit', 'nuxt', 'electron', 'vite'];
const BACKEND = ['express', 'fastify', 'hono', '@nestjs/core', 'koa', '@trpc/server', 'django', 'fastapi', 'flask'];

async function read(root: string, file: string): Promise<string> {
  const path = join(root, file);
  return existsSync(path) ? readFile(path, 'utf8') : '';
}

async function nodeDependencies(root: string, files: string[]): Promise<{ deps: Set<string>; bin: boolean }> {
  const deps = new Set<string>();
  let bin = false;
  for (const file of files.filter((f) => f.endsWith('package.json') && !f.includes('node_modules')).slice(0, 50)) {
    try {
      const pkg = JSON.parse(await read(root, file)) as Record<string, unknown>;
      for (const key of ['dependencies', 'devDependencies', 'peerDependencies'])
        for (const name of Object.keys((pkg[key] as Record<string, string> | undefined) ?? {})) deps.add(name);
      bin ||= Boolean(pkg.bin);
    } catch {
      /* a broken manifest says nothing about the stack */
    }
  }
  return { deps, bin };
}

export async function detectStack(root: string, files: string[]): Promise<Stack> {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = languageOf(file);
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const languages = [...counts].map(([name, n]) => ({ name, files: n })).sort((a, b) => b.files - a.files);
  const { deps, bin } = await nodeDependencies(root, files);
  const python = (await Promise.all(['pyproject.toml', 'requirements.txt'].map((f) => read(root, f)))).join('\n');
  for (const name of ['django', 'fastapi', 'flask']) if (new RegExp(`\\b${name}\\b`, 'i').test(python)) deps.add(name);
  const frameworks = [...CLIENT, ...BACKEND].filter((name) => deps.has(name));
  const kinds = new Set<Stack['kinds'][number]>();
  if (frameworks.some((f) => CLIENT.includes(f))) kinds.add('client');
  if (files.some((f) => /(^|\/)(AndroidManifest\.xml|Info\.plist|.*\.xcodeproj\/)/.test(f))) kinds.add('client');
  if (frameworks.some((f) => BACKEND.includes(f))) kinds.add('backend');
  if (counts.has('go') && files.some((f) => f.endsWith('main.go'))) kinds.add('backend');
  if (bin) kinds.add('cli');
  if (kinds.size === 0) kinds.add('library');
  return { languages, frameworks, kinds: [...kinds] };
}
