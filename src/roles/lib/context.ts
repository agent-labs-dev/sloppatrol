import type { RuntimeFactory } from '../../agents/index.js';
import type { LoadedConfig } from '../../config/index.js';
import type { RepoRules } from '../../rules/index.js';
import type { Store } from '../../store/index.js';

/** What every role needs, built once per patrol cycle. */
export type RoleContext = {
  loaded: LoadedConfig;
  store: Store;
  runtimeFor: RuntimeFactory;
  /** The playbook pages for the repo's stack. */
  playbook: string;
  /** The repo's own rules that apply to these files (AGENTS.md, CLAUDE.md, ...). */
  rules: (near: string[]) => Promise<RepoRules>;
  log: (line: string) => void;
};

/** A role's system prompt: who it is, the playbook, then the repo's rules, which win. */
export async function systemPrompt(ctx: RoleContext, role: string, near: string[]): Promise<string> {
  return `${role}\n\n${ctx.playbook}\n\n---\n\n${(await ctx.rules(near)).text}`;
}
