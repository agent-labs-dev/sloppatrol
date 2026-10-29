import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { CliAgent } from './schema.js';

const ORDER: CliAgent[] = ['claude', 'codex', 'opencode'];

function onPath(name: string, path: string): boolean {
  return path
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        accessSync(join(dir, name), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

/** The agent CLIs installed on this machine, in order of preference. */
export function installedAgents(path = process.env.PATH ?? ''): CliAgent[] {
  return ORDER.filter((name) => onPath(name, path));
}
