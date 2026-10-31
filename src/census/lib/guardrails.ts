import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Guardrail } from '../../domain/index.js';
import type { Stack } from './stack.js';

async function read(root: string, file: string): Promise<string> {
  const path = join(root, file);
  return existsSync(path) ? readFile(path, 'utf8').catch(() => '') : '';
}

/** The compiler of each of these rejects a wrong type. JavaScript has no compiler check, so it is not here. */
const STATIC_LANGUAGES = ['typescript', 'go', 'rust', 'swift', 'kotlin', 'java', 'csharp'];

/** A language with this share of the code lines or more needs its own type check. */
const MAIN_SHARE = 0.1;

/** Evidence that a check rejects a wrong type in each language, keyed by language. */
async function typeChecks(root: string, files: string[]): Promise<Record<string, string | undefined>> {
  let python: string | undefined = files.find((f) => /(^|\/)(mypy\.ini|pyrightconfig\.json)$/.test(f));
  for (const file of files.filter((f) => /(^|\/)(pyproject\.toml|setup\.cfg)$/.test(f))) {
    if (python) break;
    if (/\[(tool\.(mypy|pyright|ty)|mypy)\]/.test(await read(root, file)))
      python = `${file}: a type checker is configured`;
  }
  return {
    python,
    ...Object.fromEntries(STATIC_LANGUAGES.map((name) => [name, `${name}: the compiler checks types`])),
  };
}

/**
 * Strict types are present when each main language of the repo has a type check.
 * A repo can mix languages, such as a Rust server with a JavaScript UI.
 */
async function strictTypes(root: string, files: string[], stack: Stack): Promise<Guardrail> {
  const total = stack.languages.reduce((sum, l) => sum + l.lines, 0);
  const main = stack.languages.filter((l, i) => i === 0 || l.lines >= total * MAIN_SHARE).map((l) => l.name);
  const checks = await typeChecks(root, files);
  const missing = main.filter((name) => !checks[name]);
  return {
    name: 'Strict types',
    present: main.length > 0 && missing.length === 0,
    evidence:
      main.length === 0
        ? 'No code found.'
        : missing.length === 0
          ? main.map((name) => checks[name]).join('; ')
          : `No strict type check for ${missing.join(', ')}: a wrong type reaches run time.`,
  };
}

/**
 * The repo-wide guardrails that keep an agent from changing code wrong,
 * found from files alone. Each one turns a wrong edit into a failed check.
 */
export async function detectGuardrails(
  root: string,
  files: string[],
  stack: Stack,
  testFiles: number,
): Promise<Guardrail[]> {
  const has = (pattern: RegExp) => files.find((f) => pattern.test(f));
  const pyproject = await read(root, 'pyproject.toml');
  const pkg = await read(root, 'package.json');
  const found = (name: string, evidence: string | undefined, why: string): Guardrail => ({
    name,
    present: Boolean(evidence),
    evidence: evidence ?? why,
  });
  return [
    found(
      'Agent guide',
      has(/^(AGENTS|CLAUDE)\.md$/),
      'No AGENTS.md or CLAUDE.md at the root: agents learn the rules by trial.',
    ),
    await strictTypes(root, files, stack),
    found(
      'Linter',
      has(
        /(^|\/)(biome\.jsonc?|eslint\.config\.\w+|\.eslintrc(\.\w+)?|ruff\.toml|\.golangci\.\w+|\.swiftlint\.yml|detekt\.yml)$/,
      ) || (/\[tool\.ruff/.test(pyproject) ? 'pyproject.toml: ruff' : undefined),
      'No linter config.',
    ),
    found(
      'Module boundaries',
      has(/(^|\/)\.dependency-cruiser\.\w+$|(^|\/)\.importlinter$/) ||
        (/\[tool\.importlinter\]/.test(pyproject) ? 'pyproject.toml: import-linter' : undefined) ||
        (/eslint-plugin-boundaries|@nx\/enforce-module-boundaries/.test(pkg)
          ? 'package.json: boundary lint'
          : undefined),
      'Nothing stops a deep import across modules.',
    ),
    found('CI', has(/^(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/)/), 'No CI config found.'),
    found('Tests', testFiles > 0 ? `${testFiles} test files` : undefined, 'No test files: nothing pins behaviour.'),
  ];
}
