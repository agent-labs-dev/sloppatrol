---
name: sloppatrol
description: Set up and run Sloppatrol, a team of AI agents that patrols a repo and makes the code cleaner with small, behaviour-preserving refactors (deep modules, separation of concerns, dependency injection, fakes instead of mocks), each verified by the repo's own checks before it becomes a pull request. Use when the user wants to add Sloppatrol to a repo, write or fix .sloppatrol/sloppatrol.yml, run a survey or a refactor, read the dashboard, or understand why a refactor was rejected.
---

# Sloppatrol

The CLI is the npm package `sloppatrol`. Run it with `npx sloppatrol@latest <command>`.

## 1. What it does

- The **surveyor** records opportunities. The **refactorer** makes one real in a git worktree. The **reviewer** can only reject.
- The **gate** is code: guards on the diff (one side only, frozen files, no suppressions, no removed tests, size), then the repo's checks.
- A refactor changes source files or test files, never both. Code without tests gets characterization tests first.

## 2. Set it up

1. Run `npx sloppatrol@latest init`. It writes `.sloppatrol/sloppatrol.yml` with a guess at the checks.
2. Make `checks` the commands that prove behaviour in this repo: typecheck, lint, tests, build. Run each one yourself first. They must pass on main.
3. Put the install command in `prepare` (it runs in each fresh checkout and worktree).
4. Put generated, vendored and migration paths in `ignore`.
5. Write `.sloppatrol/instructions.md`: the house rules of this repo. They win over the built-in playbook.
6. Run `npx sloppatrol doctor`. Every line must show ✓.
7. Run `npx sloppatrol check`. It must say the checks pass.

`agent: auto` uses the first of `claude`, `codex`, `opencode` on PATH. Do not change it unless the user asks.

## 3. Run it

- `npx sloppatrol --once`: one cycle, with the dashboard on http://127.0.0.1:4322.
- `npx sloppatrol`: the patrol, every `patrol.intervalMinutes`.
- `npx sloppatrol survey`, `npx sloppatrol refactor [id]`, `npx sloppatrol publish`: one step at a time.
- `npx sloppatrol status`: the opportunities and the refactors.

Set `github.enabled: true` only when the user wants pull requests opened with their `gh` login.

## 4. Read a rejection

`npx sloppatrol status` and the dashboard (Refactors tab) show the reason. A guard finding names the file and the rule. A failed check shows its output in the Checks tab. Never weaken a check, a guard, or `ignore` to let a refactor through.
