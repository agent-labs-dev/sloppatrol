import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { CLI_AGENT_NAMES, CONFIG_DIR, CONFIG_FILE, ConfigError } from '../../config/index.js';

/** A guess at the repo's checks from its manifests. The user confirms them. */
async function guessChecks(
  root: string,
): Promise<{ name?: string; prepare: string[]; checks: { name: string; run: string }[] }> {
  if (existsSync(join(root, 'package.json'))) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as {
      name?: string;
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const declared = pkg.packageManager?.split('@')[0];
    const pm =
      declared === 'bun' || declared === 'pnpm' || declared === 'yarn' || declared === 'npm'
        ? declared
        : existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))
          ? 'bun'
          : existsSync(join(root, 'pnpm-lock.yaml'))
            ? 'pnpm'
            : existsSync(join(root, 'yarn.lock'))
              ? 'yarn'
              : 'npm';
    const install = {
      bun: 'bun install --frozen-lockfile',
      pnpm: 'pnpm install --frozen-lockfile',
      yarn: 'yarn install --frozen-lockfile',
      npm: 'npm ci',
    }[pm];
    const scripts = ['typecheck', 'lint', 'test', 'build'].filter((name) => pkg.scripts?.[name]);
    return { name: pkg.name, prepare: [install], checks: scripts.map((name) => ({ name, run: `${pm} run ${name}` })) };
  }
  if (existsSync(join(root, 'go.mod')))
    return {
      prepare: [],
      checks: [
        { name: 'vet', run: 'go vet ./...' },
        { name: 'test', run: 'go test ./...' },
      ],
    };
  if (existsSync(join(root, 'Cargo.toml')))
    return {
      prepare: [],
      checks: [
        { name: 'clippy', run: 'cargo clippy -- -D warnings' },
        { name: 'test', run: 'cargo test' },
      ],
    };
  if (existsSync(join(root, 'pyproject.toml'))) return { prepare: [], checks: [{ name: 'test', run: 'pytest -q' }] };
  return { prepare: [], checks: [] };
}

async function repositoryName(root: string): Promise<string> {
  const origin = await promisify(execFile)('git', ['remote', 'get-url', 'origin'], { cwd: root }).then(
    ({ stdout }) =>
      stdout
        .trim()
        .replace(/\.git\/?$/, '')
        .split(/[/:]/)
        .filter(Boolean)
        .at(-1),
    () => undefined,
  );
  return origin || basename(root);
}

export async function init(root: string, agent: string, log: (line: string) => void): Promise<void> {
  if (agent !== 'auto' && !CLI_AGENT_NAMES.includes(agent))
    throw new ConfigError(`--agent must be auto or one of ${CLI_AGENT_NAMES.join(', ')}`);
  const dir = join(root, CONFIG_DIR);
  const file = join(dir, CONFIG_FILE);
  if (existsSync(file)) throw new ConfigError(`${file} exists already.`);
  const guess = await guessChecks(root);
  const name = guess.name || (await repositoryName(root));
  const checks = guess.checks.length
    ? guess.checks
        .map((c) => `  - name: ${c.name}\n    run: ${c.run}${c.name === 'test' ? '\n    tests: true' : ''}`)
        .join('\n')
    : '  - name: test\n    run: echo "set your test command" && exit 1\n    tests: true';
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    `# Sloppatrol: https://github.com/agent-labs-dev/sloppatrol
# Commit this file and instructions.md. runs/ is local data.
version: 1
project: { name: ${JSON.stringify(name)} }
# The agent every role runs on. auto: the first of claude, codex, opencode on PATH.
# Or a model on an API key: { runtime: model, via: anthropic, model: claude-opus-5-5 }
agent: ${agent}
# Runs in each fresh checkout and worktree, before the checks.
prepare:
${guess.prepare.map((p) => `  - ${p}`).join('\n') || '  []'}
# The oracle: these must pass on main before any work, and on every refactor.
# The stronger your tests, the bolder Sloppatrol can be.
checks:
${checks}
# Files no agent may change (generated, vendored, migrations).
ignore: []
# Test files that none of the checks above runs (an e2e tier, for example).
uncheckedTests: []
guards:
  maxFiles: 12
  maxLines: 600
# A role can run on another agent with \`use:\`, e.g. reviewer: { use: codex }.
agents:
  surveyor: { maxPerSurvey: 8 }
  refactorer: { maxPerCycle: 1, maxAttempts: 2 }
  reviewer: { enabled: true }
# Quality metrics an assessor scores blind; each refactor must raise its target metric.
metrics: { enabled: true, panel: 100, tolerance: 0.5, judges: 3, parallel: 3 }
github: { enabled: false, maxOpen: 3 }
# How hard the patrol works: see docs/configuration.md. maxLoad defaults to the CPU count.
patrol: { intervalMinutes: 60, pull: origin/main, nice: 10, backoff: true, maxCyclesPerDay: 6 }
`.replace('prepare:\n  []', 'prepare: []'),
  );
  const instructions = join(dir, 'instructions.md');
  if (!existsSync(instructions))
    await writeFile(
      instructions,
      `# House rules for Sloppatrol\n\n<!-- The agents read this file. It wins over the built-in playbook. Write the\nconventions of this repo: module layout, naming, patterns you want, patterns\nyou never want, areas to leave alone. -->\n`,
    );
  const gitignore = join(root, '.gitignore');
  const ignored = existsSync(gitignore) ? await readFile(gitignore, 'utf8') : '';
  if (!ignored.includes('.sloppatrol/runs'))
    await appendFile(gitignore, `${ignored && !ignored.endsWith('\n') ? '\n' : ''}.sloppatrol/runs/\n`);
  log(`Created ${file}.`);
  log('Next: run `sloppatrol doctor`, then `sloppatrol check`, then `sloppatrol`.');
}
