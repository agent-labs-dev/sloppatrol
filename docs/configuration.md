# Configuration


```yaml
# .sloppatrol/sloppatrol.yml
agent: auto
prepare: [pnpm install --frozen-lockfile]   # each fresh checkout and worktree
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
  refactorer: { maxPerCycle: 1, maxAttempts: 2 }
  reviewer: { enabled: true }
github: { enabled: true, draft: true, maxOpen: 3, labels: [sloppatrol] }
patrol: { intervalMinutes: 60, pull: origin/main }
```

Every role also takes `maxSteps`, `timeoutMinutes` and `budgetUsd` (model runtime). Pull requests open with your `gh` login.

`.sloppatrol/sloppatrol.yml` and `.sloppatrol/instructions.md` are committed. `.sloppatrol/runs/` holds local data (checkouts, worktrees, opportunities, refactors, check runs, sessions) as plain JSON, and git ignores it.
