# Changelog

## Unreleased

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
