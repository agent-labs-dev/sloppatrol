# ADR 0003 — Roles with tools, on any runtime

**Status:** Accepted
**Date:** 2026-10-28

## Context

Teams use different agents: Claude Code, Codex, opencode, or a model on an API key. Bugpatrol and Speedpatrol showed that a role defined by its tools, not by its runtime, lets a team switch runtimes without other changes.

## Decision

Sloppatrol has four model roles (surveyor, refactorer, assessor, reviewer) and two code roles (the gate and the publisher). A model role is a system prompt, the playbook, and a set of tools. The `cli` runtime starts an agent CLI and serves the tools over a local, stateless MCP server, with the step budget on the server side; the `model` runtime runs its own tool loop over the same tool objects. `agent: auto`, the default, picks the first of `claude`, `codex`, `opencode` on `PATH`. The surveyor, the assessor and the reviewer get read-only presets; the refactorer gets an editor preset in its own worktree. The CLI injects the runtime factory, so tests run every role on a scripted agent.

## Consequences

The end-to-end tests drive every role with a scripted MCP client, so the contract is tested without a model. A new runtime is a command line.
