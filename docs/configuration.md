# Configuration


```yaml
# .sloppatrol/sloppatrol.yml
agent: auto
prepare: [pnpm install --frozen-lockfile]   # each fresh checkout and worktree
cleanup: [pnpm lint --fix]                  # mechanical tidy-up in the worktree, before the gate
checks:                                     # the oracle
  - { name: typecheck, run: pnpm typecheck }
  - { name: lint, run: pnpm lint }
  - { name: test, run: pnpm test, tests: true }   # tests: true marks the checks a planted bug must turn red
focus: [src/**]                             # where the surveyor looks (default: everywhere)
ignore: [src/generated/**]                  # what no agent may change
uncheckedTests: [tests/e2e/**]              # tests no check runs: no refactor may change them
guards: { maxFiles: 12, maxLines: 600 }
metrics: { enabled: true, panel: 100, tolerance: 0.5, judges: 3 }   # panel: files newly scored per cycle
agents:
  surveyor: { minBacklog: 3, maxPerSurvey: 8 }
  refactorer: { maxPerCycle: 1, maxAttempts: 2, timeoutMinutes: 45, cleanupTimeoutMinutes: 15 }
  reviewer: { enabled: true }
github: { enabled: true, draft: true, maxOpen: 3, labels: [sloppatrol] }
patrol: { intervalMinutes: 60, pull: origin/main }
```

Every role also takes `maxSteps`, `timeoutMinutes` and `budgetUsd` (model runtime). Pull requests open with your `gh` login.

`cleanup` runs in the refactorer's worktree after its session and before the gate: deterministic, mechanical tidy-up such as removing an import the edit made unused or formatting. A failing cleanup command is logged and left to the checks, so it never decides a verdict by itself. It is not a check and never weakens one.

A refactorer session that reaches `timeoutMinutes` hands its worktree to one completion session (`cleanupTimeoutMinutes`, `cleanupMaxSteps`) that finishes the change and removes what it left unused, instead of letting the gate reject a half-finished edit.

`.sloppatrol/sloppatrol.yml` and `.sloppatrol/instructions.md` are committed. `.sloppatrol/runs/` holds local data (checkouts, worktrees, opportunities, refactors, check runs, sessions) as plain JSON, and git ignores it.
