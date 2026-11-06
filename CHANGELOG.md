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

### Changed

- The surveyor looks for five more smells, each only in its behaviour-preserving form: defensive noise (checks and `try`/`catch` for cases the contracts rule out), reinvented wheels (hand-rolled code the standard library or an existing dependency does, never by adding one), session residue (debug prints nothing reads, unowned TODOs, commented-out code, placeholder names), comment narration, and incomplete migrations (an old and a new API side by side). [Smells](playbook/smells.md) maps each to an existing opportunity kind.
- Each rubric metric lists look-alikes not to count against a file (`skip`), next to what to look for, and the surveyor has a list of changes not to propose, both drawn from the removed lenses' "Do not flag" sections. The rubric text changed, so its version hash did: cached scores are not compared with new ones, and each file is scored again as the panel reaches it.
- `get_census` and `sloppatrol census` add navigation aids, found by regex without a model, for TypeScript, JavaScript, Python and Lua: how many files import each file (also shown beside the largest and most changed files), functions that only forward their parameters to one call, and top-level symbols named once elsewhere. They are labelled as places to look, not evidence. On nebula's main branch (7,041 such files) the pre-pass reads and analyses in about 1.3 seconds, and the census goes from about 0.4 to about 1.7 seconds.
