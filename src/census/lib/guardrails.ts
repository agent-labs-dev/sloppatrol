import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Guardrail } from '../../domain/index.js';
import { describeCommitHook } from './commit-hook.js';
import { detectStrictTypes } from './strict-types.js';

async function read(root: string, file: string): Promise<string> {
  const path = join(root, file);
  return existsSync(path) ? readFile(path, 'utf8').catch(() => '') : '';
}

/**
 * The repo-wide guardrails that keep an agent from changing code wrong,
 * found from files alone. Each one turns a wrong edit into a failed check.
 */
export async function detectGuardrails(root: string, files: string[], testFiles: number): Promise<Guardrail[]> {
  const has = (pattern: RegExp) => files.find((f) => pattern.test(f));
  const pyproject = await read(root, 'pyproject.toml');
  const pkg = await read(root, 'package.json');
  const found = (name: string, evidence: string | undefined, why: string): Guardrail => ({
    name,
    present: Boolean(evidence),
    evidence: evidence ?? why,
  });
  const strict = await detectStrictTypes(root, files);
  const hook = await describeCommitHook(root, files);
  return [
    found(
      'Agent guide',
      has(/^(AGENTS|CLAUDE)\.md$/),
      'No AGENTS.md or CLAUDE.md at the root: agents learn the rules by trial.',
    ),
    { name: 'Strict types', ...strict },
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
    { name: 'Pre-commit hook', ...hook, informational: true },
    found('CI', has(/^(\.github\/workflows\/|\.gitlab-ci\.yml$|\.circleci\/)/), 'No CI config found.'),
    found('Tests', testFiles > 0 ? `${testFiles} test files` : undefined, 'No test files: nothing pins behaviour.'),
  ];
}
