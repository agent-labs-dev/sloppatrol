import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';
import { languageOf } from './stack.js';

/**
 * A language counts toward the check when it holds at least this share of
 * the code files. A few build scripts in plain JavaScript don't sink a
 * TypeScript repo, but a quarter of the code untyped does.
 */
const SIGNIFICANT_SHARE = 0.1;

/** A tool's config written in code (`.eslintrc.cjs`, `vite.config.ts`) is not the code being typed. */
const TOOL_CONFIG = /(^|\/)(\.[^/]+|[^/]+\.config\.[cm]?[jt]s)$/;

/** The compiler rejects a wrong type before the code runs; no config can switch it off. */
const COMPILED = ['go', 'rust', 'swift', 'kotlin', 'java', 'csharp'];

async function read(root: string, file: string): Promise<string> {
  const path = join(root, file);
  return existsSync(path) ? readFile(path, 'utf8').catch(() => '') : '';
}

const outsideDeps = (f: string) => !/(^|\/)(node_modules|vendor|third_party)\//.test(f);

/** `strict` as a tsconfig resolves it: its own value, else the one it `extends` (local files only). */
async function tsStrict(root: string, file: string, seen = new Set<string>()): Promise<boolean> {
  if (seen.has(file)) return false;
  seen.add(file);
  const text = await read(root, file);
  const own = /"strict"\s*:\s*(true|false)/.exec(text)?.[1];
  if (own) return own === 'true';
  if (/"extends"\s*:\s*"@tsconfig\/strictest/.test(text)) return true;
  const parent = /"extends"\s*:\s*"(\.{1,2}\/[^"]+)"/.exec(text)?.[1];
  if (!parent) return false;
  const path = normalize(join(dirname(file), parent));
  return tsStrict(root, path.endsWith('.json') ? path : `${path}.json`, seen);
}

/** A language's verdict: what makes it strict, or what is missing. */
type Verdict = { ok: boolean; detail: string };

/**
 * TypeScript is strict when every tsconfig that compiles files resolves to
 * `strict: true`. A solution file (`"files": []`, only `references`) compiles
 * nothing, so it is skipped.
 */
async function typescript(root: string, files: string[]): Promise<Verdict> {
  const configs = files.filter((f) => /(^|\/)tsconfig[^/]*\.json$/.test(f) && outsideDeps(f));
  const projects: string[] = [];
  for (const file of configs) if (!/"files"\s*:\s*\[\s*\]/.test(await read(root, file))) projects.push(file);
  if (projects.length === 0) return { ok: false, detail: 'no tsconfig' };
  const loose: string[] = [];
  for (const file of projects) if (!(await tsStrict(root, file))) loose.push(file);
  if (loose.length) return { ok: false, detail: `not strict in ${loose.slice(0, 3).join(', ')}` };
  return {
    ok: true,
    detail: projects.length === 1 ? `${projects[0]}: strict` : `all ${projects.length} tsconfigs strict`,
  };
}

/** JavaScript is checked only when a strict tsconfig or jsconfig also sets `checkJs`. */
async function javascript(root: string, files: string[]): Promise<string | undefined> {
  for (const file of files.filter((f) => /(^|\/)(tsconfig|jsconfig)[^/]*\.json$/.test(f) && outsideDeps(f)))
    if (/"checkJs"\s*:\s*true/.test(await read(root, file)) && (await tsStrict(root, file)))
      return `${file}: checkJs + strict`;
  return undefined;
}

async function python(root: string, files: string[]): Promise<string | undefined> {
  const config = files.find((f) => /(^|\/)(mypy\.ini|\.mypy\.ini|pyrightconfig\.json|ty\.toml)$/.test(f));
  if (config) return config;
  for (const file of files.filter((f) => /(^|\/)(pyproject\.toml|setup\.cfg)$/.test(f) && outsideDeps(f)))
    if (/\[(tool\.)?(mypy|pyright|ty)\]/.test(await read(root, file))) return `${file}: a type checker is configured`;
  return undefined;
}

function ruby(files: string[]): string | undefined {
  return files.find((f) => /(^|\/)(sorbet\/config|Steepfile)$/.test(f));
}

/**
 * Rust's compiler already rejects a wrong type. Clippy with warnings denied
 * is the stricter gate, so it is named when found, but it is not required.
 */
async function clippyGate(root: string, files: string[]): Promise<string | undefined> {
  for (const file of files.filter((f) => /(^|\/)Cargo\.toml$/.test(f) && outsideDeps(f)))
    if (/^\[(workspace\.)?lints\.clippy\]/m.test(await read(root, file))) return `${file}: clippy lints`;
  for (const file of files.filter((f) => /^(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/)/.test(f)))
    if (/cargo clippy[^\n]*-D\s*warnings/.test(await read(root, file))) return `${file}: clippy -D warnings`;
  return undefined;
}

const found = (detail: string | undefined, missing: string): Verdict =>
  detail ? { ok: true, detail } : { ok: false, detail: missing };

async function verdict(language: string, root: string, files: string[]): Promise<Verdict> {
  if (language === 'rust') {
    const clippy = await clippyGate(root, files);
    return { ok: true, detail: clippy ? `compiler-checked, ${clippy}` : 'compiler-checked (no clippy gate found)' };
  }
  if (COMPILED.includes(language)) return { ok: true, detail: 'compiler-checked' };
  if (language === 'typescript') return typescript(root, files);
  if (language === 'javascript') return found(await javascript(root, files), 'no checkJs in a strict config');
  if (language === 'python') return found(await python(root, files), 'no mypy, pyright or ty config');
  if (language === 'ruby') return found(ruby(files), 'no Sorbet or Steep config');
  return { ok: false, detail: 'no type checker this census can detect' };
}

export type StrictTypes = { present: boolean; evidence: string };

/**
 * Whether a check rejects a wrong type in each language that makes up a real
 * share of the code. One untyped language with a large share fails it: the
 * wrong types reach run time there.
 */
export async function detectStrictTypes(root: string, files: string[]): Promise<StrictTypes> {
  const counts = new Map<string, number>();
  for (const file of files.filter((f) => !TOOL_CONFIG.test(f) && outsideDeps(f))) {
    const language = languageOf(file);
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const significant = [...counts]
    .map(([name, n]) => ({ name, files: n }))
    .filter((l) => l.files / total >= SIGNIFICANT_SHARE)
    .sort((a, b) => b.files - a.files);
  if (significant.length === 0) return { present: false, evidence: 'No code in a known language.' };
  const results = await Promise.all(
    significant.map(async (l) => ({
      name: l.name,
      share: Math.round((100 * l.files) / total),
      ...(await verdict(l.name, root, files)),
    })),
  );
  const missing = results.filter((r) => !r.ok);
  if (missing.length === 0) return { present: true, evidence: results.map((r) => `${r.name}: ${r.detail}`).join('; ') };
  const gaps = missing.map((r) => `${r.name} (${r.share}% of code files: ${r.detail})`).join(', ');
  return { present: false, evidence: `No strict type check for ${gaps}. A wrong type reaches run time.` };
}
