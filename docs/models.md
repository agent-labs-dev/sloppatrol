# Agents and models


By default every role runs on the agent CLI you have installed: `agent: auto` picks `claude`, then `codex`, then `opencode`, from your `PATH`. The surveyor and the reviewer get read-only access; the refactorer gets edit access in its own worktree. Every role reaches Sloppatrol through its tools over a local MCP server.

```yaml
agent: auto                       # or claude | codex | opencode
agents:
  reviewer: { use: codex }        # a second opinion from another agent
  surveyor:
    use: { runtime: model, via: openrouter, model: anthropic/claude-opus-5.5 }
```

`{ runtime: model, via: anthropic | openai | openrouter | custom, model }` runs Sloppatrol's own tool loop on an API key. `{ runtime: cli, command: "..." }` runs any command, with `{prompt}`, `{mcp}`, `{mcpUrl}` and `{workdir}` filled in.
