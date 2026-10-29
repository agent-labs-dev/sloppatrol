import type { RuntimeFactory } from '../../agents/index.js';
import type { GitHub } from '../../github/index.js';
import type { Store } from '../../store/index.js';

/** The adapters a patrol runs on. The CLI wires the real ones; tests wire fakes. */
export type PatrolDeps = {
  store: Store;
  github: GitHub;
  runtimeFor: RuntimeFactory;
  log: (line: string) => void;
};
