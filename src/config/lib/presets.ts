import type { AgentRole } from '../../domain/index.js';
import { installedAgents } from './detect.js';
import { ConfigError } from './load.js';
import type { CliAgent, RoleRuntimeInput, SloppatrolConfig } from './schema.js';

/** A role's runtime with its command resolved. */
export type RoleRuntime =
  | { runtime: 'cli'; command: string; label: string }
  | { runtime: 'model'; via: 'anthropic' | 'openai' | 'openrouter' | 'custom'; model: string; endpoint?: string };

/**
 * The surveyor and the reviewer read the code and act only through the
 * Sloppatrol tools. The refactorer edits files and runs commands in its own
 * worktree, so its preset allows that.
 */
const PRESETS: Record<CliAgent, { reader: string; editor: string }> = {
  claude: {
    reader:
      "claude -p --output-format json --tools 'Read,Grep,Glob' --mcp-config {mcp} --strict-mcp-config --allowedTools 'mcp__sloppatrol,Read,Grep,Glob'",
    editor: 'claude -p --output-format json --permission-mode auto --mcp-config {mcp} --allowedTools mcp__sloppatrol',
  },
  codex: {
    reader: 'codex exec --json --skip-git-repo-check --sandbox read-only -c mcp_servers.sloppatrol.url={mcpUrl} -',
    editor:
      'codex exec --json --skip-git-repo-check --sandbox workspace-write -c mcp_servers.sloppatrol.url={mcpUrl} -',
  },
  opencode: {
    reader: `OPENCODE_CONFIG_CONTENT='{"mcp":{"sloppatrol":{"type":"remote","url":"'{mcpUrl}'","oauth":false}},"permission":{"edit":"deny","bash":"deny"}}' opencode run --format json`,
    editor: `OPENCODE_CONFIG_CONTENT='{"mcp":{"sloppatrol":{"type":"remote","url":"'{mcpUrl}'","oauth":false}}}' opencode run --format json`,
  },
};

/** The runtime one role runs on: its own `use`, else the top-level `agent`, with `auto` resolved. */
export function resolveRuntime(config: SloppatrolConfig, role: AgentRole, path?: string): RoleRuntime {
  let use: RoleRuntimeInput = config.agents[role].use ?? config.agent;
  if (use === 'auto') {
    const agent = installedAgents(path)[0];
    if (!agent)
      throw new ConfigError(
        'No agent CLI found on PATH. Install claude, codex or opencode, or set `agent: { runtime: model, via: anthropic, model: ... }`.',
      );
    use = { runtime: 'cli', agent };
  }
  if (use.runtime === 'model') return use;
  const preset = use.agent ? PRESETS[use.agent][role === 'refactorer' ? 'editor' : 'reader'] : undefined;
  const command = ('command' in use ? use.command : undefined) ?? preset ?? '';
  return { runtime: 'cli', command, label: use.agent ?? command.trim().split(/\s+/)[0] ?? 'shell' };
}
