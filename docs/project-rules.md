# Project rules and the audit

The patrol makes one verified refactor at a time. The audit and the project-rules gate are the other half of Sloppatrol: they find slop in a path or a branch diff, keep what was found in a ledger that the next audit and the surveyor read, and turn what must not come back into rules that CI enforces. They need no service and no API key.

## The audit

The audit is a route of the [Sloppatrol skill](../skills/sloppatrol/SKILL.md), run by your own agent: `sloppatrol audit`, `sloppatrol audit <path>` or `sloppatrol audit diff`. It reviews the code through the [lenses](../skills/sloppatrol/references/lenses/), the same set the surveyor uses: dead code, parallel implementations, reinvented wheels, narrating comments, speculative abstraction, defensive noise, stale docs and the rest. Separate verifiers try to refute each finding. It changes only what it proves behaviour-preserving, and records the rest for a person to decide.

## What a repository keeps

```text
.sloppatrol/
  gate.py  agents.py  LICENSE  SOURCE.md        the vendored tools, MIT, and their hashes
  sgconfig.yml  rules/  rule-tests/             ast-grep rules and their tests
  scripts/  script-tests/  lib/                 script rules and their tests
  lenses/                                       the repo's own lenses
  runs/  reports/  ledger.json                  local data, ignored by git
.agents/skills/sloppatrol-project/SKILL.md      what the audit settled for this repo
```

`sloppatrol init` vendors the tools, and `sloppatrol init --refresh` updates them. A refresh keeps a copy you edited and says so, because its hash no longer matches `SOURCE.md`.

## The gate in CI

The gate is stdlib Python 3.10 or later. It needs ast-grep only when the repo has ast-grep rules.

```yaml
- uses: actions/checkout@v7
  with: { fetch-depth: 0 }
- uses: agent-labs-dev/sloppatrol@<sha>
```

The action runs `python .sloppatrol/gate.py --base origin/<base branch>`, plus `.sloppatrol/agents.py check` when the repo vendors it, and annotates each finding on the pull request. A plain step that runs the same commands works as well.

The gate runs every rule over the whole tree, except a rule scoped `changed`, which counts hits only in files changed since the base. It also checks every `sloppatrol: <id> - <reason>` marker (a known id, a real reason, no unused marker), and that no deleted rule is still named in the tree. It exits 0 when clean, 1 on a finding, and 2 when it cannot run.

## How the patrol uses them

- `project-rules` joins your checks when `.sloppatrol/gate.py` exists, so a refactor must pass your rules too.
- A refactor may not add a `sloppatrol:` marker, or change `AGENTS.md`, `CLAUDE.md` or the project skill.
- The surveyor reads the ledger's confirmed findings, and an opportunity can name the ones it resolves. Its pull request lists them.
- Every agent reads the project skill with your other rules.
