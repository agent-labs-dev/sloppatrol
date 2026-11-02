# Project rules: growing the gate

sloppatrol ships no deterministic rules. Each repository grows its own, from defects it actually had, and
runs them in its own gate. Review finds a defect once; a rule stops it for good. A mature repository
ends up with dozens, every one traceable to a real occurrence.

## Contents

- [Rule or lens?](#rule-or-lens)
- [Where a rule lives](#where-a-rule-lives)
- [Running the gate](#running-the-gate)
- [Writing one](#writing-one)
- [Backlogs: ratchet, don't weaken](#backlogs-ratchet-dont-weaken)
- [Suppressions](#suppressions)
- [Promotion from audits](#promotion-from-audits)
- [Retiring and merging rules](#retiring-and-merging-rules)
- [Shapes and the mechanism that fits](#shapes-and-the-mechanism-that-fits)

## Rule or lens?

**Judgment is never a rule.** If a reviewer could look at a hit and reasonably say "this one is
fine", it belongs in a review lens (`.sloppatrol/lenses/`), not in a check that blocks. A threshold is
a rule only when the number states a fact ("this change grew a file already over 1000 lines"), not a
quality guess ("functions should be short").

Everything else that a tool can recognise, such as a banned call, a layer boundary, a missing
pairing or a stale generated file, should be a rule. When an audit confirms such a defect, writing
the rule is part of fixing it.

## Where a rule lives

Use the first that can express it:

1. **The linter the project already runs.** Banned imports and APIs, naming, complexity limits:
   ruff's `flake8-tidy-imports` banned-api (`TID251`), ESLint's `no-restricted-syntax` and
   `no-restricted-imports`, luacheck globals, clippy lints. No new tool, and the project already
   reads its output. Prefer it only where the linter's suppression can carry a checked reason, or
   the rule has no exceptions at all; a bare `noqa` records none.
2. **An ast-grep rule** for a single-file structural shape the linter cannot express:
   `.sloppatrol/rules/<id>.yml`, with its tests in `.sloppatrol/rule-tests/<id>-test.yml`.
3. **A script rule** for facts ast-grep cannot see: cross-file and repository-wide ones (one
   migration head, a private symbol used from another file, docs that cite a path that no longer
   exists, a generated file that is stale). `.sloppatrol/scripts/<id>.<ext>`, an executable with a `#!`
   line, written in the project's language, with test cases in `.sloppatrol/script-tests/<id>/`.
4. **A test in the project's own suite** for a check that needs the project imported, such as a
   runtime registry. The gate never imports project code.

## Running the gate

The gate is `.sloppatrol/gate.py`, vendored from sloppatrol byte for byte. It runs every ast-grep rule and its
tests, every script rule and its tests, and checks every suppression marker:

```sh
python3 .sloppatrol/gate.py                      # full gate
python3 .sloppatrol/gate.py --rule no-raw-sql    # one rule (repeatable), its tests and its markers
python3 .sloppatrol/gate.py --base origin/main   # the ratchet base for changed-scope rules
python3 .sloppatrol/gate.py --all                # every file counts as changed: the whole backlog
python3 .sloppatrol/gate.py --json               # one JSON object, suppressed hits included
python3 .sloppatrol/gate.py --fast --base origin/main  # before a push: only what this branch can change
```

`--fast` skips rule tests for rules the branch did not touch, scans changed files only with
untouched ast-grep rules, and skips scripts whose `sloppatrol-inputs:` the branch missed. It never drops
a finding on a changed file, but it can hide one the base already had elsewhere, so CI runs the
full gate.

| Exit | Meaning |
|---|---|
| 0 | every stage ran and found nothing |
| 1 | findings: offenders, failing rule or script tests, or marker problems |
| 2 | the gate cannot run or is misconfigured. Fix the gate, not the code |

Each finding prints as `path:line: <id> <message>`, followed by one `fix:` line per rule with
findings. Under GitHub Actions each finding is also an `::error` annotation, and the log ends
with every finding listed between `=== sloppatrol findings: N ===` and `=== end sloppatrol findings ===`. The full contract (layout, validation, base resolution, script protocol) is in
[contracts.md](contracts.md#project-rules).

## Writing one

1. **Start from the real occurrence.** Write the rule against the code that actually shipped, before
   fixing it. A rule that reports zero on the defect you just saw measures nothing.
2. **Run it over the whole tree** (`python3 .sloppatrol/gate.py --rule <id> --all`) and read every hit.
   Narrow it until every hit is real. Record what you saw (hits, true positives, backlog) in the
   rule's `note` or the script's header.
3. **Give it tests that fire both ways.** The gate refuses a rule without them.
4. **Make it explain itself.** The message names the defect. The fix text gives the fix and the
   reason, for the person who hits it months later without context.
5. **It blocks.** The gate has no warning tier. A shape whose backlog cannot be drained now is
   ratcheted (below); a shape that needs judgment is a lens.
6. **Run `python3 .sloppatrol/gate.py`** and commit the rule with its tests and the fix.

### ast-grep rules

```
.sloppatrol/sgconfig.yml               ruleDirs: [rules]; testConfigs: [{testDir: rule-tests}]
.sloppatrol/rules/<id>.yml             one rule; `id` equals the file stem
.sloppatrol/rule-tests/<id>-test.yml   at least one `invalid:` case it must flag and one `valid:` look-alike
```

- `message` and `note` are required; `note` is the fix text. `severity` is absent or `error`.
- A `files:` glob must match at least one file in the repository, so a rule scoped to a renamed
  directory fails loudly instead of passing forever. `ignores:` is never checked.
- `rule-tests/` holds only test files: ast-grep fails on any other YAML there.
- Plain `ast-grep scan` in an editor shows hits the gate suppresses. The gate is the authority.

### Script rules

A script reads its inputs from environment variables, prints one offender per line as
`path:line: <id> <message>`, and exits 0 when clean or 1 with at least one line. Anything else
(another exit code, a malformed line, a timeout) is a protocol breach and fails the gate with
exit 2. A whole-file fact uses line 1. The variables are in
[contracts.md](contracts.md#script-rule-protocol).

The header, in the first 40 lines, in any comment syntax:

```python
#!/usr/bin/env python3
# sloppatrol-scope: changed
# sloppatrol-fix: split the file along its responsibilities before adding to it
```

- `sloppatrol-fix:` is required; it is the fix text the gate prints.
- `sloppatrol-scope:` is `all` (the default) or `changed`.
- `sloppatrol-inputs:` is optional: space-separated globs naming every file a slow whole-tree script
  reads, such as `src/**/*.py pyproject.toml`. Only `--fast` uses it, to skip the script when the
  branch changed none of them ([contracts.md](contracts.md#fast-mode)). A file left off the list
  hides findings in local runs, never in CI, so add it only to scripts that make `--fast` slow.
- Scripts run in parallel. A script that writes a scratch file uses a temporary directory, never a
  fixed path in the repository.
- Helpers that several scripts share live in `.sloppatrol/lib/`, which the gate never runs.
- Each script has cases in `.sloppatrol/script-tests/<id>/<case>/`: a `head/` tree, an optional `base/`
  tree, and an `expected` file listing the `path:line` entries the script must report. At least one
  case has a non-empty `expected`, and at least one an empty one.
- The gate keeps cases out of `SLOPPATROL_FILES` and `SLOPPATROL_CHANGED`, but the project's own linters and
  type checkers still see them: a case that is bad on purpose needs their exclude, not a fix.

## Backlogs: ratchet, don't weaken

When a shape is only wrong in bulk, or the backlog cannot be drained in one change, scope the rule
to what the change touches instead of loosening it:

- an ast-grep rule gets `metadata: {sloppatrol-scope: changed}`: its hits count only in files added,
  modified or renamed since the merge-base;
- a script rule gets `sloppatrol-scope: changed` and compares against the base itself: it reads the old
  file with `git show "$SLOPPATROL_BASE:<old path>"`, takes renames from `SLOPPATROL_CHANGED`, and matches sites
  by line text, not by line number.

The gate resolves the base and fails closed (exit 2) when it cannot: an unresolvable ref, a shallow
clone, or a pull request whose merge-base is HEAD. CI checks out with `fetch-depth: 0` and passes
`--base`. `--all` shows the whole backlog.

Ratchet only where the fix is local to the diff that trips it; otherwise an unrelated one-line
change inherits a file's whole backlog.

## Suppressions

There is one syntax. A suppression is a whole-line comment naming the rule and the **contract that
makes this occurrence safe**:

```python
# sloppatrol: no-raw-sql - runs inside the migration, before the model layer exists
op.execute("UPDATE ...")
```

- It covers a hit within the three lines above it, or anywhere in the comment block directly above
  it. The same marker works for rules, script rules and lenses.
- "False positive", "intentional", "legacy" and restatements of the code are not reasons.
- A marker that covers no hit of a rule that ran over the whole tree fails the gate
  (`sloppatrol-unused-marker`). Lens markers are not checked.
- `ast-grep-ignore` is banned: rewrite it as a `sloppatrol:` marker.

The grammar, the exact coverage rule and every marker code are in
[contracts.md](contracts.md#suppressions).

## Promotion from audits

An audit's evidence command that a verifier confirmed, and that has been narrowed to zero false
positives, becomes a `.sloppatrol/scripts/` rule with tests in the same change. The audit's Guard for that
finding then names the rule. A command that still needs a reader to discard hits stays evidence.

## Retiring and merging rules

A rule retires only on a cited criterion, stated in the commit:

1. **Redundant.** Another enforced check covers it, shown by that check failing on the rule's
   invalid case.
2. **Gone.** The feature it guards no longer exists, shown with a search.
3. **Judgment.** It never reached zero because hits need a reader. It becomes a lens.

The gate's `sloppatrol-retired-id` stage reports current tracked references to deleted rule and script ids, excluding reports, runs, ledger files and changelogs.

Two rules merge only when the survivor flags every invalid case of the rule it absorbs. Otherwise
both stay. Delete markers naming a retired id in the same change; the gate reports them otherwise.

A retirement is not finished until nothing still cites the id or the thing it guarded. In the same
change, search for the id and for the idea (a number, a limit, a name) in: markers, rule-tests and
script-tests, ledger guards (`rule:<id>` becomes `lens-only: <why>` or a `settled:` entry),
reports, runs and ledger files, `AGENTS.md`, skills and docs, dev scripts, build and CI files. `ledger.py guards` checks stored guards, the gate's `sloppatrol-retired-id` stage checks references to deleted rule and script ids, and the rest is a search.
Prose
that quotes the retired rule's threshold needs rewording, not a grep for the id.

## Shapes and the mechanism that fits

The shapes repositories keep needing, and where each belongs. sloppatrol ships none of these as rules:
each repository writes its own against its own occurrence.

| Shape | Mechanism |
|---|---|
| Banned call or import | the linter's banned-API rule; an ast-grep pattern where there is none |
| Call allowed only in its owner module | the linter's banned-API rule with a per-file exception for the owner; or an ast-grep rule with the owner in `ignores:` |
| Retired identifier | an ast-grep rule matching the identifier, whose note names the replacement; a script rule when it also appears in config or prose |
| Cited path exists | a script rule over the files that cite paths; `agents.py check` already covers `AGENTS.md` |
| Generated file is fresh | the generator's own check mode as a CI step; a script rule that regenerates into a temporary directory and diffs, where there is none |
| Loud default on a closed set | the type checker's exhaustiveness check first; an ast-grep rule for a fallthrough branch it cannot see |
| Migration safety | the migration linter the ecosystem has (for PostgreSQL, squawk); otherwise a changed-scope script rule over new migrations |
| Explicit local typography preferences (dashes, arrows, the ellipsis character) | a whole-tree script rule over text files once the tree is clean |
| File growth ratchet | a changed-scope script rule |
| Swallowed exception | the linter where it has the rule (ruff `S110`); an ast-grep rule otherwise |

When a project has no rules yet, the first ones usually come from its `AGENTS.md` or contributing
guide: every written "never do X" that a tool could check, and whose shape occurs in the tree, is a
rule waiting to be written.

