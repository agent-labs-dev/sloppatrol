import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';
import { configSchema, type SloppatrolConfig } from './schema.js';

export const CONFIG_DIR = '.sloppatrol';
export const CONFIG_FILE = 'sloppatrol.yml';

/** A problem in the user's config or environment. The CLI exits with code 2. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export type LoadedConfig = {
  config: SloppatrolConfig;
  /** The `.sloppatrol` folder. */
  dir: string;
  /** The repository Sloppatrol patrols. */
  source: string;
};

/** Finds `.sloppatrol/sloppatrol.yml` from `cwd` upwards. */
function findConfigDir(cwd: string): string | undefined {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    if (existsSync(join(dir, CONFIG_DIR, CONFIG_FILE))) return join(dir, CONFIG_DIR);
    if (dirname(dir) === dir) return undefined;
  }
}

export async function loadConfig(cwd: string): Promise<LoadedConfig> {
  const dir = findConfigDir(cwd);
  if (!dir) throw new ConfigError(`No ${CONFIG_DIR}/${CONFIG_FILE} here or above. Run \`sloppatrol init\`.`);
  const file = join(dir, CONFIG_FILE);
  let raw: unknown;
  try {
    raw = parse(await readFile(file, 'utf8')) ?? {};
  } catch (error) {
    throw new ConfigError(`${file}: ${(error as Error).message}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${file}: ${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new ConfigError(issues.join('\n'));
  }
  return { config: parsed.data, dir, source: resolve(dirname(dir), parsed.data.project.source) };
}
