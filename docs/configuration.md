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
metrics: { enabled: true, panel: 100, tolerance: 0.5, judges: 3, parallel: 3 }   # panel: files newly scored per cycle; parallel: assessor sessions at once
agents:
  surveyor: { minBacklog: 3, maxPerSurvey: 8 }
  refactorer: { maxPerCycle: 1, maxAttempts: 2, timeoutMinutes: 45, cleanupTimeoutMinutes: 15 }
  reviewer: { enabled: true }
github: { enabled: true, draft: false, maxOpen: 3, labels: [sloppatrol] }
patrol: { intervalMinutes: 60, pull: origin/main }
```

## How hard the patrol works

The defaults keep the patrol light, so it can stay on next to your own work on a shared machine:

```yaml
metrics: { panel: 100, judges: 3, parallel: 3 } # 100 new files scored per cycle; three assessor sessions at once
agents:
  refactorer: { maxPerCycle: 1, maxCheckRuns: 1 } # one refactor per cycle; it runs your checks once before the gate
patrol:
  nice: 10                # CPU niceness of Sloppatrol and everything it starts; on Linux also I/O priority best-effort 7. 0: normal
  checks: []              # the names of the checks the patrol runs, e.g. [typecheck, unit]; empty runs them all
  intervalMinutes: 60     # the shortest wait between cycles
  backoff: true           # double the wait after each cycle that finds nothing...
  maxIntervalMinutes: 1440 # ...up to a day
  maxCyclesPerDay: 6      # 0: no cap
  maxLoad: 8              # skip a cycle while the 1-minute load average is above this; default the CPU count, 0 never skips
```

Every check also has a `timeoutMinutes` (20 by default). The checks run once on each new commit of `patrol.pull`, once when the refactorer asks, and once in the gate; a tests refactor adds one run for its planted bug. Use `patrol.checks` to leave a slow tier out; add its tests to `uncheckedTests` so no refactor changes them.

An assessor session waits on its model, not the CPU: three at once used about 1.2 GB and a fifth of one core in total, scoring about 14 s a file against 46 s for one at a time. On a machine short of memory, set `metrics: { panel: 20, parallel: 1 }`.

For the earlier, heavier schedule, set `agents.refactorer.maxCheckRuns: 20` and `patrol: { nice: 0, backoff: false, maxCyclesPerDay: 0, maxLoad: 0 }`.

Every role also takes `maxSteps`, `timeoutMinutes` and `budgetUsd` (model runtime). Pull requests open with your `gh` login.

`cleanup` runs in the refactorer's worktree after its session and before the gate: deterministic, mechanical tidy-up such as removing an import the edit made unused or formatting. A failing cleanup command is logged and left to the checks, so it never decides a verdict by itself. It is not a check and never weakens one.

A refactorer session that reaches `timeoutMinutes` hands its worktree to one completion session (`cleanupTimeoutMinutes`, `cleanupMaxSteps`) that finishes the change and removes what it left unused, instead of letting the gate reject a half-finished edit.

`.sloppatrol/sloppatrol.yml` and `.sloppatrol/instructions.md` are committed. `.sloppatrol/runs/` holds local data (checkouts, worktrees, opportunities, refactors, check runs, sessions) as plain JSON, and git ignores it.
