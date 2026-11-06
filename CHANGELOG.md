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

**Migration.** A repository that vendors `.sloppatrol/gate.py` or `.sloppatrol/agents.py`, or calls the action in CI, keeps working from its own copy, but nothing here updates it. Either drop the gate, its CI job and its `sloppatrol:` markers, or own the rules: move them under a path of your own and run them as an ordinary check. Delete `.sloppatrol/ledger.json` and `.sloppatrol/reports/`, which nothing reads now.
