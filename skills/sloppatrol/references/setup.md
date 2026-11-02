# sloppatrol setup

Goal: leave the repository with a quality gate that runs everywhere, CI that runs it, a project
skill that makes later audits sharper, and project rules that stop real defects coming back. Setup
is rerunnable: a second run on an unchanged repository proposes nothing.

## 1. Inventory

Establish facts from the tree, not from file names: `git ls-files` by extension, the largest files,
manifests, CI, tool configs and packaging manifests. Read enough of the README, `AGENTS.md` /
`CLAUDE.md` and CI to learn what the project is, what it already enforces, and what its authors care
about.

- A tool is present when `command -v` finds it **and** it runs. A test runner is the one the tests
  actually use (read a spec's first lines and the CI job).
- A file is generated when its generator is known, not because its header says so.
- Nested worktrees and scratch checkouts are not the project; make every tool exclude them.
- Per language with meaningful code, record how it is built, run and packaged, and its entrypoints,
  including indirect ones (manifests, registries, framework conventions, plugin hooks). Those are
  the **live roots** the dead-code lens must respect.

## 2. Measure the gaps

Per language, record `ok` / `gap` / `broken` / `n/a (reason)` with the command and its result:

| Concern | Covered means |
|---|---|
| Format, lint, types | the project's tools are configured and run clean |
| Tests | a test command exists and runs |
| Dead code, duplication | an evidence tool (reachability analyser, `jscpd`) runs on demand |
| Project rules | `python3 .sloppatrol/gate.py` exits 0 |
| Secrets, CI hygiene | a secret scanner runs in CI; workflows are linted (`actionlint`, `zizmor`), actions pinned to SHAs |
| Hooks, dependency updates | a fast pre-commit path exists; Dependabot or Renovate covers each ecosystem |
| Agent instructions | `agents.py check` passes and CI runs it |
| Documentation | the existing Markdown/MDX build, links and metadata checks are inventoried |

**Run every tool you count as coverage.** A config that exists but cannot run is a gap. Present one
table, then say which changes you will make.

## 3. Close the gaps

Default scope: every `gap` or `broken` whose fix is conventional. Ask before replacing a tool the
project chose, adding a runtime dependency or a new CI provider, or landing a change that fails CI
in bulk.

- **Prefer what the project already uses**, and use the ecosystem's current recommended tool,
  checked against upstream docs. Pin versions, and pin GitHub Actions to full commit SHAs with a
  version comment (resolve a tag with `git ls-remote <url> 'refs/tags/<tag>^{}'`).
- **Adopt, don't flood.** Fix a new linter's existing findings when that is mechanical, or scope it
  to new code and list the backlog. Never land a red CI.
- **Verify locally** before wiring a check into CI, and pin the rule set, not just the version.
- **Noisy checkers become evidence, not gates** until they are clean.
- **Exclude the config files from the release artifact** when the project has a packaging manifest.
- **Update the docs** that list checks, CI jobs or dev commands in the same change.
- **Evidence tools are on-demand, not gates**, unless the project already treats them that way.
- **Rerun the whole gate** after the last change, and keep each concern separately reviewable.

## 4. Write the project skill

Create `.agents/skills/sloppatrol-project/SKILL.md` from [assets/project-skill.md](../assets/project-skill.md)
and fill it with verified facts, not aspirations: the exact gate and evidence commands; live roots
and indirect entrypoints; **model-read text** and the project check that covers it (write "none"
when there is none); human-doc readers, evidence sources and supported outputs; zones; conventions;
risk order; **Settled** and **Anti-patterns**, both empty at setup.

If the repository uses Claude Code, symlink `.claude/skills/sloppatrol-project` to the canonical
copy. Add `.sloppatrol/runs/`, `.sloppatrol/reports/` and `.sloppatrol/ledger.json` to `.gitignore`: the
ledger is the audit's local memory, and the other two are scratch.

## 5. Write AGENTS.md

`AGENTS.md` is what every agent reads first, so it is part of the gate, not decoration. Context
files do not generally raise task success and cost more, so keep it an index:

- **Only non-discoverable facts:** the gate commands in order (`agents.py check` reports
  `missing-gate` when they are absent), paths whose role the name does not say, boundaries
  (generated or vendored trees), and constraints that have cost a review cycle.
- **Never** a directory tree, a stack summary, an incident narrative, or retired names; the code and
  manifests already say the first two.
- **Link depth, don't inline it.** Codex reads at most 32 KiB of instruction files per session and
  drops the rest; `agents.py check` names the section that falls past the cut.
- **`CLAUDE.md`** is `@AGENTS.md` plus Claude-only lines, never a second copy.
- Run `python3 <skill>/scripts/agents.py check` until it passes, and vendor it to
  `.sloppatrol/agents.py` so CI cannot drift.

## 6. Project rules

sloppatrol ships no rules; the project grows its own from defects it actually had
([rules.md](rules.md)). `sloppatrol init` vendors `gate.py`, `agents.py` and their licence into
`.sloppatrol/` and records their hashes in `SOURCE.md`; `init --refresh` updates copies, keeping one
the repository edited. Never edit a vendored copy.

- **Wire the gate into CI** with the action in [docs/project-rules.md](../../../docs/project-rules.md),
  passing `--base` (a checkout does not create `origin/HEAD`) and `fetch-depth: 0`. Keep the `name`
  of any job a branch protection rule already requires.
- **Red before it lands.** When going green needs loosening (a marker, an exclude, a narrowed rule),
  report the red lines and the loosening instead of wiring the job.
- **Seed rules from real occurrences only**, following [rules.md](rules.md); shapes the tree has
  never had are speculation. A judgment defect specific to this codebase becomes a project lens in
  `.sloppatrol/lenses/`.
- Enable ast-grep only once a rule exists; then add `.sloppatrol/sgconfig.yml` and pin
  `ast-grep-cli`. The gate looks for `ast-grep`, never `sg`.

## 7. Report

End with the gap table before and after, every command you ran, the files created or changed, the
backlog you left, and the next step, usually `sloppatrol audit`.
