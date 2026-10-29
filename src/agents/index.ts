import type { RoleRuntime } from '../config/index.js';
import { CliRuntime } from './lib/cli-runtime.js';
import { ModelRuntime } from './lib/model-runtime.js';
import type { Runtime } from './lib/types.js';

export { editTools, repoTools } from './lib/repo-tools.js';
export { finishTool, str, strList, tool } from './lib/schema.js';
export { runRole } from './lib/session.js';
export type { RoleOutcome } from './lib/types.js';

/** Builds the runtime for a role. The CLI injects this; tests can inject their own. */
export type RuntimeFactory = (use: RoleRuntime) => Runtime;

export const createRuntime: RuntimeFactory = (use) =>
  use.runtime === 'cli' ? new CliRuntime(use) : new ModelRuntime(use);
