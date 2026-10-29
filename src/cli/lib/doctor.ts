import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installedAgents, type LoadedConfig, resolveRuntime } from '../../config/index.js';
import { AGENT_ROLES } from '../../domain/index.js';
import { resolveRef } from '../../git/index.js';
import { RUBRIC_VERSION } from '../../metrics/index.js';
import { readRepoRules } from '../../rules/index.js';

const exec = promisify(execFile);

/** Commands that choose what to run from the diff against a base. */
const DIFF_SCOPED = /--changed\b|--only-?changed|--changed-?since|--since\b|--find-?related|\baffected\b/i;

/** Prints what Sloppatrol will run on, and returns false when something blocks it. */
export async function doctor(loaded: LoadedConfig, out: (line: string) => void): Promise<boolean> {
  const { config } = loaded;
  let ok = true;
  const line = (good: boolean, text: string) => {
    ok &&= good;
    out(`${good ? '✓' : '✗'} ${text}`);
  };
  out(`config     ${loaded.dir}/sloppatrol.yml`);
  out(`repository ${loaded.source}`);
  const agents = installedAgents();
  out(`agent CLIs ${agents.length ? agents.join(', ') : 'none on PATH'}`);
  for (const role of AGENT_ROLES) {
    try {
      const runtime = resolveRuntime(config, role);
      line(
        true,
        `${role.padEnd(10)} runs on ${runtime.runtime === 'cli' ? runtime.label : `${runtime.via}:${runtime.model}`}`,
      );
    } catch (error) {
      line(false, `${role.padEnd(10)} ${(error as Error).message}`);
    }
  }
  const sha = await resolveRef(loaded.source, config.patrol.pull);
  line(Boolean(sha), `patrols ${config.patrol.pull}${sha ? ` at ${sha.slice(0, 10)}` : ': cannot resolve it'}`);
  line(config.checks.length > 0, `${config.checks.length} check(s): ${config.checks.map((c) => c.name).join(', ')}`);
  for (const check of config.checks.filter((c) => DIFF_SCOPED.test(c.run)))
    out(
      `! ${check.name} picks its work from the diff (\`${check.run}\`). On main it then runs less than on a refactor, so a failure there can be old: prefer a command that runs the same work on every commit.`,
    );
  if (config.github.enabled) {
    const auth = await exec('gh', ['auth', 'status']).then(
      () => true,
      () => false,
    );
    line(auth, auth ? 'gh is signed in: pull requests will open' : 'gh is not signed in: run `gh auth login`');
  } else out('- github.enabled is false: verified refactors wait for `sloppatrol publish`');
  if (!config.checks.some((c) => c.tests))
    out('! No check has `tests: true`: the mutation proof of a tests refactor runs every check.');
  const rules = await readRepoRules(loaded.source, loaded.dir);
  out(`rules      ${rules.sources.join(', ') || 'none found (no AGENTS.md, CLAUDE.md or contributor guide)'}`);
  out(
    `metrics    ${config.metrics.enabled ? `on: up to ${config.metrics.panel} more files scored per cycle, rubric ${RUBRIC_VERSION}` : 'off'}`,
  );
  out('\nNext: `sloppatrol check` proves your checks pass on main.');
  return ok;
}
