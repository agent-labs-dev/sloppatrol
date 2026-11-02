# sloppatrol setup

Goal: leave the repository with a working, current, deterministic quality gate for every language
it contains, CI that runs that gate, and a project-specific sloppatrol skill that makes every later audit
sharper. Setup is **rerunnable**: a second run on an unchanged repository proposes nothing.

## Contents

- [1. Inventory](#1-inventory)
- [2. Measure the gaps](#2-measure-the-gaps)
- [3. Close the gaps](#3-close-the-gaps)
- [4. Write the project skill](#4-write-the-project-skill)
- [5. Write AGENTS.md](#5-write-agentsmd)
- [6. Project rules](#6-project-rules)
- [7. Refresh vendored tools](#7-refresh-vendored-tools)
- [8. Report](#8-report)

## 1. Inventory

Establish the facts yourself; do not infer them from file names. Start from what git tracks:
`git ls-files` counted by extension, the largest files, manifests, CI workflows, tool configs,
packaging manifests (`.pkgmeta`, `.npmignore`, `files`, `MANIFEST.in`, `export-ignore`). Then read,
only as far as needed: `README`, `AGENTS.md` / `CLAUDE.md` / contributor docs, manifests, CI. You
are learning what the project *is*, what it already enforces, and what its authors clearly care
about.

A tool is present when `command -v` finds it **and** it runs; a test runner is the one the tests
actually use (read a spec's first lines and the CI job: `*_spec.lua` run by plain `luajit` is not
busted). A file is generated when its generator is known, not because its header says "generated".

Nested worktrees and scratch checkouts (`.claude/worktrees/`, `.worktrees/`, other `git worktree
list` paths inside the tree) are not the project. Make sure every tool setup configures excludes
them, or it will report other branches' code; scan tracked files where the tool allows it.

Establish, per language that holds meaningful code (ignore vendored, generated and fixture trees):

- how it is built, run and packaged, and what its runtime is (a browser, a game client, a CLI, a
  server, a library consumed by others);
- its entrypoints, including indirect ones: manifests that list files, registries, framework
  conventions, plugin hooks. These become the **live roots** the dead-code lens must respect;
- which of the concerns below are covered, and whether that coverage actually works.

If a language has no file in `references/languages/`, follow `references/languages/generic.md`.


## 2. Measure the gaps

For each language present, evaluate these concerns against its language reference:

| Concern | Covered means |
|---|---|
| Format | a formatter is configured **and** `--check` passes or is one command from passing |
| Lint | a linter with a deliberate rule set runs clean (or its failures are known and listed) |
| Types | a type checker or language server check runs, where the language has one |
| Tests | a test command exists and runs |
| Dead code | an evidence tool for unused symbols/files/dependencies is runnable on demand |
| Duplication | a clone detector (usually `jscpd`) or equivalent is runnable on demand |
| Project rules | the vendored gate runs: `python3 .sloppatrol/gate.py` exits 0 (step 6) |
| Secrets | a secret scanner (usually `gitleaks`) runs in CI |
| CI hygiene | workflows are linted (`actionlint`), security-scanned (`zizmor`), actions pinned to SHAs, `permissions:` least-privilege |
| Hooks | a fast pre-commit path exists (optional: note it, do not force it) |
| Dependency updates | Dependabot or Renovate covers each ecosystem present |
| Agent instructions | `AGENTS.md` passes `scripts/agents.py check` and CI runs that check (step 5) |
| Documentation | existing Markdown/MDX build, links, metadata, components and supported alternate-output checks, with coverage recorded; prose lint such as `markdownlint-cli2` or [Vale](https://vale.sh/) is advisory unless adopted locally; semantic review follows [docs.md](docs.md) |

**Run every tool you count as coverage.** A config that exists but cannot run is a gap. Record the
exact command and whether it passed.

Present the result as one table: concern × language, with status `ok` / `gap` / `broken` /
`n/a (reason)`, the evidence (command + result), and the proposed change. Then say which changes you
will make.

## 3. Close the gaps

Default scope: everything marked `gap` or `broken` whose fix is conventional for the ecosystem. Ask
before anything the user might reasonably reject: replacing a tool the project already chose,
adding a new runtime dependency, a new CI provider, or a change that would fail CI on existing code
in bulk.

Rules for every change:

- **Prefer what the project already uses.** Extend an existing tool before introducing a parallel
  one. Never add a second formatter or a second linter for the same language.
- **Use the language reference's recommended tool**, checked against current upstream docs. Pin
  versions in CI; pin GitHub Actions to full commit SHAs with a version comment. Resolve a tag
  with `git ls-remote https://github.com/<owner>/<repo> 'refs/tags/<tag>^{}'` (falling back to the
  plain tag): an annotated tag's own SHA is a tag object, not the commit.
- **Adopt, don't flood.** A new linter or rule set that reports hundreds of pre-existing findings
  goes in with the existing findings fixed (when mechanical and safe, e.g. formatting), or scoped so
  it fails only on new code, and the backlog is listed in the report. Never land a red CI.
- **Verify locally** that each new check runs and passes before wiring it into CI.
- **Pin the rule set, not just the version.** Select a linter's rules explicitly in config; a
  tool's defaults change between releases and silently move the existing configuration.
- **Noisy checkers become evidence, not gates.** When a type checker or linter reports mostly false
  positives the project cannot fix (a host API it cannot model), run it on demand, list the known
  false positives in the project skill, and gate only once it is clean.
- **Check what ships.** If the project has a packaging manifest (`.pkgmeta`, `.npmignore`,
  `package.json` `files`, `MANIFEST.in`, export-ignore), make sure every config file setup adds is
  excluded from the release artifact.
- **Update docs that describe the tooling.** A README or contributor guide that lists the checks, CI
  jobs or dev commands is stale the moment setup changes them; fix it in the same change.
- **Rerun the whole gate** after the last change, not just each new check: one tool's new files
  (fetched annotations, a config) can break another.
- **Evidence tools are on-demand, not gates.** Dead-code and duplication detectors produce
  candidates that need judgment; they run during audits, not as blocking CI jobs, unless the project
  already treats them that way.
- Keep each concern's change small and separately reviewable. If the user asked for commits, make
  one per concern.

## 4. Write the project skill

Create `.agents/skills/sloppatrol-project/SKILL.md` from [assets/project-skill.md](../assets/project-skill.md).
It is the project's memory for sloppatrol: every later audit loads it first. Fill it with facts you
verified, not aspirations:

- the exact gate commands, in the order to run them, and what "pass" looks like, ending with
  `python3 .sloppatrol/gate.py` and the ast-grep pin (step 6);
- the evidence commands per language, with the known false-positive sources for each;
- live roots and indirect entrypoints (e.g. files listed by a manifest, framework-registered
  handlers, names looked up by string, persisted data formats), including consumers in other
  repositories: the things a dead-code pass must never delete on "no references found";
- **model-read text**: where the project keeps text a model reads (prompts, tool and parameter
  descriptions, schema docstrings, model-visible enum values) and which project check validates a change to
  it. Audits never edit that text as cleanup; they route it to the owner. Write "none" when there
  is none;
- for human docs: audience and supported clients/releases, authoritative release and policy sources,
  text-bearing components and alternate outputs, exact existing checks and their coverage gaps.
  Keep semantic review separate from lint, following [docs.md](docs.md);
- zones: which paths are production, scripts, tests, fixtures, config, docs, generated or vendored.
  Fixtures are inputs a test or rule reads (seeded cases, snapshots, script-test trees). The audit
  reviews each zone differently and never edits fixtures, generated or vendored code;
- conventions the codebase visibly follows (naming, module layout, error handling, comment style)
  so the audit judges drift against *this* project, not a generic ideal;
- subsystems in risk order, which the audit uses to slice the tree;
- **Settled**: shapes that look like defects here but are not, each with its reason and one path
  (a guard the type checker needs to narrow, a method the host calls by name). Reviewers and
  verifiers read it; audits add to it.
- **Anti-patterns**: empty at setup. Audits add confirmed defect shapes that recur, each a named
  entry, and guard them with `settled:<name>`.

`.agents/skills/sloppatrol-project/` is the canonical copy. If the repository uses Claude Code (`.claude/`
exists), add the symlink `.claude/skills/sloppatrol-project -> ../../.agents/skills/sloppatrol-project`.

Add `.sloppatrol/runs/` to `.gitignore`: every audit writes review scratch output there.
`.sloppatrol/ledger.json` and `.sloppatrol/reports/` are committed; they are the memory later audits start from.

## 5. Write AGENTS.md

`AGENTS.md` is what every agent, from any vendor, reads first, so it is part of the gate, not
decoration. Context files often do not help: in one study they did not generally raise task success
and cost over 20% more, and repository overviews were no use; what helped was instructions for
non-standard practices ([arXiv 2602.11988](https://arxiv.org/abs/2602.11988)). So the file
is an index, and it is checked.

- **Create or update it** as a short index. Keep every line the authors wrote that is still true;
  setup adds what is missing and corrects what
  `agents.py check` or the `stale-docs` lens proves stale. It never rewrites for style.
- **Only non-discoverable facts:** the gate commands (the same ones as the project skill, in order;
  `agents.py check` fails with `missing-gate` when `.sloppatrol/gate.py` exists and no checks block runs it),
  paths whose role the name does not say, boundaries (generated or vendored trees, files never to
  edit by hand), constraints that have cost a review cycle.
- **Never:** a directory tree, a summary of the stack, an incident narrative, or names the project
  has retired. The code and the manifests already say the first two; the last two age into
  instructions nobody can follow.
- **Stay under the byte budget.** Codex reads at most 32 KiB of instruction files per session (its
  `project_doc_max_bytes` default), counted along the chain from the root `AGENTS.md` to the nested
  one, and drops the rest. `agents.py check` reports the overrun and the section that falls past the
  cut.
- **Link depth, don't inline it.** Detail lives in skills, loaded when a task needs them.
- **Skills.** `agents.py check` also checks every skill in the repository
  ([contracts.md](contracts.md#skills)). Repair, rather than existing configuration, what it reports:
  - `skill-over-budget`: move the longest sections verbatim into `references/`, one file per
    section, its name starting with the section's number. Leave each heading in place with a link to its file and a
    `Read when:` line naming the task, path or symptom that needs it, so existing `§N` and anchor
    citations still resolve in one hop. In a procedure, move only the largest steps so it still
    reads top to bottom. Prove the move lost nothing: every non-blank line of the old `SKILL.md`
    appears in the new files, link targets aside.
  - `skill-orphan`: link the file from the step that needs it, saying when to read it, or delete it.
  - `skill-frontmatter`: make `name` the directory name, and make the description say what the
    skill does and when to load it.

- **`CLAUDE.md`**: Claude Code reads `CLAUDE.md`, not `AGENTS.md`. Where Claude Code is used (a
  `.claude/` directory, or the user says so), `CLAUDE.md` is the line `@AGENTS.md` plus any
  Claude-only lines. Never a second copy that drifts.
- **Run `python3 <skill>/scripts/agents.py check`** until it passes. Fix existing problems or list
  them in the report. Do not hide failures behind an exclusion.
- **Check inference limits.** Follow the [reference and command grammar](contracts.md#agent-instructions)
  for external citations and text/output fences. If a necessary form still produces a reproduced
  false positive, record the case and keep this check advisory for the affected project until
  fixed, as in step 3. Do not hide it or real failures behind a blanket existing configuration.
- **Vendor the check** so it cannot go stale: `sloppatrol init` copies `scripts/agents.py` to `.sloppatrol/agents.py`. CI runs `python3 .sloppatrol/agents.py check`.

## 6. Project rules

sloppatrol ships no rules; the project grows its own ([rules.md](rules.md)). Setup installs the gate that
runs them and starts the rule set.

### Vendor the gate

Run `sloppatrol init` to vendor `scripts/gate.py` as `.sloppatrol/gate.py`. Never edit the copy: a change belongs
in the installed skill, and `sloppatrol init --refresh` preserves local edits and reports any hash
difference (step 7). The gate with no rules exits 0 and needs
no ast-grep, so every repository gets it.

The gate's `sloppatrol-retired-id` stage reports current tracked references to deleted rule and
script ids, including references in configuration and prose.

Copy the skill's `LICENSE` to `.sloppatrol/LICENSE` with it. Sloppatrol is MIT-licensed, so the
licence text travels with the vendored copies.

When the first ast-grep rule is added, also write `.sloppatrol/sgconfig.yml`:

```yaml
ruleDirs: [rules]
testConfigs:
  - testDir: rule-tests
```

and pin ast-grep, recording the pin in the project skill:

- a uv project: `ast-grep-cli==0.44.1` in the dev dependency group, and the gate runs as
  `uv run python .sloppatrol/gate.py`;
- anything else: `uv tool install ast-grep-cli==0.44.1` after a SHA-pinned `astral-sh/setup-uv`
  step.

The gate finds ast-grep on `PATH` as `ast-grep` only, never as `sg`, which collides with the
`sg` of shadow-utils.

### Wire it into CI

Add this job next to the linters. It has least-privilege permissions, keeps `${{ }}` out of
`run:`, and passes `--base` explicitly because `actions/checkout` does not create `origin/HEAD`:

```yaml
  sloppatrol:
    name: sloppatrol
    runs-on: ubuntu-latest
    permissions: {contents: read}
    steps:
      - uses: actions/checkout@<sha> # v7.0.1
        with: {fetch-depth: 0, persist-credentials: false}
      - uses: agent-labs-dev/sloppatrol@<sha>
        with:
          base: origin/${{ github.base_ref || github.event.repository.default_branch }}
```

- Resolve each `<sha>` as in step 3, and keep the version comment.
- The action runs the vendored gate, annotates each finding on the diff, and ends its log with a
  `=== sloppatrol findings: N ===` block listing all of them.
- `fetch-depth: 0` is required: the gate refuses a shallow clone when a rule is changed-scope.
- `--base`, never `--all`: under `--all` every file counts as changed, so a changed-scope rule
  reports its whole backlog and cannot land while one exists.
- A uv project can run its own `uv sync --locked` before the action. The raw equivalent is
  `python3 .sloppatrol/gate.py --base "origin/$BASE"`, followed by
  `python3 .sloppatrol/agents.py check` when the repository vendors that check.
- `ledger.py guards` runs from the installed skill during an audit; it is not vendored.
- **Red before it lands.** When the gate is red and going green needs loosening (a marker, an
  exclude, a narrowed rule), do not add the job yet. Report the red lines and the loosening each
  needs, and wire the job once the user approves it or the cause is fixed.
- **Keep the name of an existing required check.** If a branch ruleset or protection rule already
  requires a check that runs sloppatrol, keep that job's `name`. A required check that no job reports
  leaves every pull request waiting. Rename a job only together with its ruleset.
- Run `actionlint` and `zizmor` over the changed workflow.

### Rules the project already owns

List the structural checks the project already enforces (tests in its own suite that pin a
registry, a layer boundary or a generated file; linter rules) in the project skill as rules already
owned. Do not duplicate them as gate rules.

### Seed the rule set

- **From written conventions.** Every "never do X" in `AGENTS.md`, contributor docs or review
  comments that a tool could check is a rule candidate. Write the ones whose shape occurs in the
  tree, following [rules.md](rules.md): real occurrence, whole-tree run, tests both ways. Rules for
  shapes the tree has never had are speculation; list them in the report instead.
- A class of problem that needs judgment specific to this codebase gets a project lens,
  `.sloppatrol/lenses/<id>.md`, in the same format as the built-in ones.

## 7. Refresh vendored tools

Run `sloppatrol init` to vendor `gate.py`, `agents.py` and `LICENSE` into `.sloppatrol/`, and
write `.sloppatrol/SOURCE.md` with their hashes. Run `sloppatrol init --refresh` when a newer copy is
available. A refresh keeps a repository-edited vendored file and reports that its hash differs from
`SOURCE.md`. The ledger is never vendored: the audit runs the skill's own
`scripts/ledger.py`.

## 8. Report

End with: the gap table before and after, every command you ran to verify, the files created or changed, the backlog you deliberately left, and the recommended next step, usually `sloppatrol audit`.
