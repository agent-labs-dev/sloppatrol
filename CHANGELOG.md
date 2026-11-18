# Changelog

## [Unreleased]

## [0.4.1] - 2026-11-18

### Fixed

- The scorecard shows each assessor's whole evidence instead of cutting it at 200 characters.
- The `sloppatrol.yml` that `init` writes says run data is kept in `.sloppatrol/runs/` (git-ignored) and checkouts in the user's cache.
- `sloppatrol publish` prints "No verified refactors to publish." when there is nothing to publish, with or without `--dry-run`.

## [0.4.0] - 2026-11-16

### Breaking

- `sloppatrol init` writes `checks: []` when it cannot find the repository's test command, instead of a placeholder check that always fails. Sloppatrol does not load a config without checks, so add the real ones to `.sloppatrol/sloppatrol.yml` before `sloppatrol check` or a patrol.
- The improvement proof keeps a refactor when at least one target metric improves and no scored metric drops by more than `metrics.tolerance`. Before, every target had to go up and only the non-target metrics had the tolerance.
- Source checkouts and worktrees live in the user's cache (`$XDG_CACHE_HOME/sloppatrol`, or `~/.cache/sloppatrol`), keyed by source and profile, so tools that lint the repository never see them. Reports stay in the profile's `runs/`. On the next run, Sloppatrol moves or prunes the checkouts an older version left under `runs/`.

### Added

- `sloppatrol check --ref <ref>` runs the checks on another commit instead of `patrol.pull`. `--ref HEAD` tries your branch's committed files with the working tree's profile. `check` takes the repository lock, so it cannot prune a checkout a running patrol uses.
- `prepare` and `cleanup` accept `{ run: <command> }`, Speedpatrol's shape, as well as a plain string.
- [Configuration](docs/configuration.md) explains where the checks run and how `prepare` carries an ignored cache into the checkout.

### Changed

- `init` uses the declared package manager or lockfile, including `bun.lock` and `bun.lockb`. Project names come from package metadata or the origin repository before the checkout folder.
- The census counts Lua source files.
- Config validation uses Zod 4, so some error messages read differently.
- CI validates workflows and scans the full Git history for secrets. Superseded PR checks cancel automatically.

### Fixed

- A cached source checkout is checked before reuse, and a stale or half-migrated worktree is recreated.

## [0.3.0] - 2026-11-06

### Breaking

Sloppatrol is a patrol again, and only a patrol: a surveyor, a refactorer, a code gate (your own checks plus a planted bug), three blind assessors and a veto-only reviewer. The audit and the project-rules gate are removed:

- `scripts/gate.py`, `scripts/ledger.py` and `scripts/agents.py`, and their Python tests.
- The skill's audit, verify, rules, docs, setup and contracts routes, and the lens and language references that fed them. The playbook (`playbook/smells.md` and the rest) is the surveyor's reference again.
- The `project-rules` patrol check, and the surveyor's `list_findings` and `get_lens` tools.
- `sloppatrol init` no longer vendors `gate.py`, `agents.py`, `LICENSE` or `SOURCE.md` into `.sloppatrol/`, and `sloppatrol init --refresh` is gone.
- The composite GitHub Action (`uses: agent-labs-dev/sloppatrol@<sha>`).

`sloppatrol review <pr|branch>` stays.

The patrol is light by default, so it can stay on across many repos on a shared machine. Scoring keeps its pace: 100 new files a cycle, three assessor sessions at once, since they wait on the model rather than the CPU.

- Sloppatrol and every check and agent it starts run at niceness 10, and on Linux at I/O priority best-effort 7 (`patrol.nice`, 0 for normal priority).
- `patrol.checks` names a fast check set for the patrol. The refactorer runs the checks at most once per attempt before the gate (`agents.refactorer.maxCheckRuns`).
- A cycle waits while the 1-minute load average is above the CPU count (`patrol.maxLoad`), and at most 6 cycles start in any 24 hours (`patrol.maxCyclesPerDay`). After a cycle that finds nothing, the wait doubles, up to a day (`patrol.backoff`, `patrol.maxIntervalMinutes`).
- **Breaking:** `sloppatrol` no longer serves the dashboard. Add `--dashboard`, or run `sloppatrol dashboard`.
- `sloppatrol --once` runs one cycle and exits, and skips the cycle while the machine is busy or the daily cap is reached: it suits a scheduled CI job.

[Configuration](docs/configuration.md#how-hard-the-patrol-works) lists the settings that bring back the old schedule.

**Migration.** A repository that vendors `.sloppatrol/gate.py` or `.sloppatrol/agents.py`, or calls the action in CI, keeps working from its own copy, but nothing here updates it. Either drop the gate, its CI job and its `sloppatrol:` markers, or own the rules: move them under a path of your own and run them as an ordinary check. Delete `.sloppatrol/ledger.json` and `.sloppatrol/reports/`, which nothing reads now.

### Changed

- The surveyor looks for five more smells, each only in its behaviour-preserving form: defensive noise (checks and `try`/`catch` for cases the contracts rule out), reinvented wheels (hand-rolled code the standard library or an existing dependency does, never by adding one), session residue (debug prints nothing reads, unowned TODOs, commented-out code, placeholder names), comment narration, and incomplete migrations (an old and a new API side by side). [Smells](playbook/smells.md) maps each to an existing opportunity kind.
- Each rubric metric lists look-alikes not to count against a file (`skip`), next to what to look for, and the surveyor has a list of changes not to propose, both drawn from the removed lenses' "Do not flag" sections. The rubric text changed, so its version hash did: cached scores are not compared with new ones, and each file is scored again as the panel reaches it.
- `get_census` and `sloppatrol census` add navigation aids, found by regex without a model, for TypeScript, JavaScript, Python and Lua: how many files import each file (also shown beside the largest and most changed files), functions that only forward their parameters to one call, and top-level symbols named once elsewhere. They are labelled as places to look, not evidence. On nebula's main branch (7,041 such files) the pre-pass reads in about 0.2 seconds and analyses in about 1 second, and the census goes from about 0.4 to about 1.5 seconds.
- A source refactor keeps the tests as strong: the gate plants up to `mutation.sourceBugs` bugs (2 by default) on lines the refactor kept, on main and on the change, and rejects the refactor when the tests catch one on main and miss it on the change. Each bug costs one run of the test checks on main, and one more on the change when main's tests catch it: at most four extra runs per source refactor by default. Set `mutation.sourceBugs: 0` to turn it off.
