# Contracts

The formats Sloppatrol's helpers enforce. `scripts/gate.py`, `scripts/ledger.py` and `scripts/agents.py`
are the reference implementations; if this page and a script disagree, the script is right and this
page is a bug. Each is single-file, standard-library Python 3.10+. `ledger.py` imports its marker
parser and registered ids from `gate.py` beside it; only `gate.py` runs project code, and only the
project's own script rules.

## Contents

- [Run file](#run-file)
- [Ledger](#ledger)
- [Registered ids](#registered-ids)
- [Suppressions](#suppressions)
- [Project rules](#project-rules)
- [Project lenses](#project-lenses)
- [Agent instructions](#agent-instructions)

## Run file

A reviewer writes one JSON file per slice and batch, `.sloppatrol/runs/<slice>-<batch>.json`
(git-ignored):

```json
{
  "lenses": ["dead-code", "session-residue"],
  "scope": ["src/export.py", "src/util.py"],
  "files_read": ["src/export.py", "src/util.py"],
  "findings": [
    {
      "lens": "dead-code",
      "file": "src/util.py",
      "quote": "def parse_legacy(row):",
      "what": "parse_legacy has no caller",
      "why": "no reference in src, tests, scripts, CI or open branches",
      "confidence": "high"
    }
  ],
  "notes": "optional free text"
}
```

- Paths are relative to the repository root and may not escape it. Unknown keys are rejected.
- `lenses` are the ids this reviewer applied; each must be registered (below). Every `scope` file
  must appear in `files_read`, and every finding's file must be in both. A file only an evidence
  scan covered was not read: leave it out, and the report counts it as not reviewed.
- `quote` is one or more whole lines copied verbatim from the file. Matching ignores whitespace
  differences within a line, so reformatting does not orphan a finding, but any other edit does.
- `confidence` is `high`, `medium` or `low`.

`ledger.py check RUN... [--json]` checks each run. Per finding: `REPORTED` (quote found),
`SUPPRESSED` (a valid suppression covers it), or `UNVERIFIABLE` (quote missing, file outside scope
or unread, lens unknown). Per run, the worst wins:

| Outcome | Exit | Meaning |
|---|---|---|
| `CLEAN` | 0 | valid, no reported findings |
| `FINDINGS` | 0 | valid, findings reported |
| `INCOMPLETE` | 1 | a finding is unverifiable, a lens is unknown, or scope files were not read: fix and rerun |
| `FAILED` | 2 | unreadable file or invalid JSON shape |

A finding whose id the ledger holds as `decide`, `dismissed`, `unproven`, `bug` or `fixed` carries
that verdict (`previous` in JSON, `PREVIOUSLY <STATUS>: <reason>` in text), and `add` keeps it. The
audit re-verifies `unproven` items, which nobody settled; the others are not re-verified. The id
changes when the quoted code does, and then it is a new finding.

## Ledger

`.sloppatrol/ledger.json` is committed; it is the memory the next audit starts from.

```json
{"schema_version": 1, "items": [{"id": "3f9a1c0b2e", "lens": "dead-code", "file": "src/util.py",
  "quote": "def parse_legacy(row):", "what": "...", "why": "...", "confidence": "high",
  "status": "dismissed", "reason": "called by name from the plugin manifest", "first_seen": "2026-09-24",
  "updated": "2026-09-24"}]}
```

- `id` = first 10 hex of `sha256(lens \0 file \0 normalized quote)`. When the quoted code changes,
  the finding gets a new id, so a dismissal never outlives the code it judged.
- Statuses:

  | Status | Meaning | Needs |
  |---|---|---|
  | `open` | recorded, not yet verified | nothing |
  | `confirmed` | verified real, not yet fixed | a guard |
  | `decide` | the owner must choose: a design, proposal, copy or route-elsewhere case | a reason holding the exact question for the owner |
  | `dismissed` | verified not a defect | a reason |
  | `unproven` | could not be proved either way | a reason |
  | `bug` | a behaviour bug found along the way; recorded with its evidence, never fixed in the slop pass | a reason |
  | `fixed` | the quote is gone from the file | a guard |

  A reason has at least three words and is not generic ("false positive", "intentional" and the like).
- A **guard** is what stops the defect coming back. It is one of:

  | Guard | Kind | Checked |
  |---|---|---|
  | `rule:<id>` | `rule` | `<id>` is a rule or script rule the gate discovers in `.sloppatrol/rules/` or `.sloppatrol/scripts/` |
  | `rule:<tool>:<code>` | `tool-rule` | an existing linter's rule, e.g. `rule:ruff:BLE001`; syntax only |
  | `settled:<name>` | `settled` | `<name>` is a `- **<name>**` entry under the Anti-patterns heading of `.agents/skills/sloppatrol-project/SKILL.md`, compared case-insensitively with runs of spaces collapsed. A Settled entry's name is refused: Settled tells verifiers to dismiss the shape |
  | `lens-only: <why>` | `lens-only` | why no rule can catch it; a reason as above |

  It is stored on the item as `guard`. Setting `fixed` without `--guard` reuses the guard stored when
  the item was confirmed; a `confirmed` or `fixed` item with no guard at all is refused. Moving an
  item to any other status drops its guard.

| Command | Does | Exit |
|---|---|---|
| `add RUN... [--partial]` | records unsuppressed findings as `open`, keeping existing verdicts | 0; 1 if any run is incomplete (nothing written) unless `--partial` |
| `set ID... --status S [--reason R] [--guard G]` | records a verdict | 0; 1 if `fixed` is refused because the quote is still present; 2 for unknown ids, a bad reason, or a missing or bad guard |
| `list [--status S]... [--json]` | items grouped by status, with the reason, the guard, and the current line or `gone`, or `no items` when none match; JSON items always have `guard` (`null` when none) | 0 |
| `guards` | re-resolves every stored `rule:<id>` and `settled:<name>` guard against the current rules and Anti-patterns entries; prints each that names nothing | 0; 1 if any is stale |
| `rekey` | recomputes ids that no longer match their lens, file and quote (a refactor moved the file), keeping verdicts, reasons and guards; single-file ledgers only; refuses if two items would collide | 0; 2 on a collision |

All commands take `--root` (default: the Git toplevel, else cwd). Usage, registry and ledger errors
exit 2. Writes are atomic and sorted, so the file diffs cleanly.

## Registered ids

An id is registered when it is one of:

- an `id:` in `.sloppatrol/rules/*.yml`;
- the stem of a file in `.sloppatrol/scripts/`;
- a built-in lens (`playbook/lenses/<id>.md`; `gate.py` carries the list as `BUILTIN_LENSES`);
- the stem of a project lens, `.sloppatrol/lenses/<id>.md`.

There is no other source. Ids match `[a-z0-9][a-z0-9-]*` and are unique across rules, scripts and
lenses. The `sloppatrol-` prefix is reserved for the gate's own codes: a rule, script or lens whose id
starts with `sloppatrol-` is a configuration error, and a marker naming a `sloppatrol-` code is an unknown id, so a gate
problem can never be suppressed. Another tool's rules are suppressed with that tool's own syntax.

## Suppressions

A marker is a line that holds nothing but a comment, in the file's line-comment syntax:

```
<comment> sloppatrol: <id> - <reason>
```

```lua
-- sloppatrol: dead-code - called by name from Bindings.xml, which no static search follows
function MyAddon_ToggleWindow() end
```

- `<comment>` is the line-comment token for the file type (`#`, `//`, `--`, `;`). `gate.py`
  holds the table from extensions and named files to tokens. A type without a line comment,
  Markdown and JSON included, cannot carry a marker: a hit there is fixed, or the rule's `files` or
  `ignores` leaves the file out.
- `<id>` is a registered id. The separator is exactly ` - `.
- `<reason>` states the **contract that makes this occurrence safe**. It has at least three words
  and is not a generic phrase. Compared case-insensitively with punctuation stripped, the generic
  phrases are: false positive, intentional, legacy, needed, ok, safe, todo, temporary, see above, as
  above.

**Coverage.** A valid marker on line M covers a hit of the same id on line L when either:

- L-3 ≤ M ≤ L; or
- M lies in the unbroken block of whole-line comments that ends on line L-1; or
- L is 1 (a whole-file fact) and M lies in the file's leading block of whole-line comments, which
  starts on line 2 when line 1 is a `#!` line.

Lines are 1-based and split on newline alone, as ast-grep counts them; a form feed or a Unicode line
separator does not start a line.

A rule whose reported line is not the one a reader would annotate is reshaped to report that line;
markers are never moved to suit a rule.

**Marker checks.** The gate checks every file in its corpus. Each is a finding (exit 1):

| Code | Condition |
|---|---|
| `sloppatrol-unknown-id` | the id is not registered |
| `sloppatrol-weak-reason` | the reason is empty, generic, or under three words |
| `sloppatrol-bad-marker` | a comment containing `sloppatrol:` that does not parse |
| `sloppatrol-trailing-marker` | a `sloppatrol:` token after code on the same line; it would cover nothing |
| `sloppatrol-ast-grep-ignore` | any comment containing `ast-grep-ignore`; use `sloppatrol:`. In a file an ast-grep rule applies to whose type has no entry in the comment table (a `languageGlobs` mapping, say), any line containing the word |
| `sloppatrol-unused-marker` | the marker names a rule that ran over the whole tree in this invocation (a rule with scope `all`, or any rule under `--all`) and covers none of its hits. Lens ids are never checked; changed-scope rules only under `--all` |

`ast-grep-ignore` is banned because it carries no reason, covers only the next line, and on line 1
followed by a blank line suppresses the whole file.

Under `--rule`, a marker check runs for markers naming a selected id and for markers with no
parseable id (`ast-grep-ignore`, or a `sloppatrol:` comment whose id does not parse), which belong to no
rule.

Known limitation: a comment-shaped line inside a multi-line string literal is read as a comment.

## Project rules

`scripts/gate.py` is the reference implementation of this section. It is standard-library Python
3.10+, contains no rules, makes no network calls and never imports project code. A
repository vendors it byte for byte as `.sloppatrol/gate.py`. The command line, exit codes, script
protocol and marker grammar are sloppatrol's public interface under semver.

### Layout

```
.sloppatrol/
  gate.py                    vendored gate
  agents.py                  vendored AGENTS.md check (optional)
  sgconfig.yml               ruleDirs: [rules]; testConfigs: [{testDir: rule-tests}]
  rules/<id>.yml             one ast-grep rule per file; id equals the stem
  rule-tests/<id>-test.yml   ast-grep rule tests; nothing else lives here
  scripts/<id>.<ext>         executable script rule with a #! line; regular files only
  script-tests/<id>/<case>/  head/  [base/]  expected
  lib/                       helpers scripts import; never run by the gate
  lenses/<id>.md             project lenses
```

### Interface

```sh
python3 .sloppatrol/gate.py [--rule ID]... [--base REF | --all] [--fast] [--json]
```

| Flag | Meaning |
|---|---|
| (none) | the full gate |
| `--rule ID` | repeatable; only these rules, their tests, and the marker checks for markers naming them (see [Suppressions](#suppressions)). An unknown id exits 2 |
| `--base REF` | the ratchet base (see [Base](#base)); an empty REF is a usage error |
| `--all` | the base is the empty tree, so every file is changed: changed-scope rules report their whole backlog, and unused markers are checked for them. Combined with `--base` it is a usage error |
| `--fast` | a local pre-push run that skips work this branch cannot affect (see [Fast mode](#fast-mode)). It always resolves the base; combined with `--all` it is a usage error |
| `--json` | one JSON object on stdout, suppressed hits included |

The gate runs from `git rev-parse --show-toplevel`. It finds `ast-grep` on `PATH`, never `sg`;
ast-grep is needed only when `.sloppatrol/rules/` holds a rule. The corpus is
`git ls-files -co --exclude-standard -z`, keeping paths that exist, minus every script-test case (a
path under `script-tests/<id>/<case>/` at any depth, so rule fixtures are not
scanned either). The gate passes ast-grep an explicit file list, so hidden directories such as
`.github` are scanned and untracked nested clones are not.

`--json` prints:

```json
{"version": "0.3.0", "ast_grep": "0.44.1",
 "base": {"ref": "origin/main", "merge_base": "1a2b3c4d...", "changed": 3},
 "findings": [{"id": "no-raw-sql", "kind": "ast-grep", "path": "src/db.py", "line": 12,
               "message": "...", "suppressed": true, "marker_line": 11}]}
```

`kind` is `ast-grep`, `script` or `gate`. `marker_line` is the covering marker's line, or `null`.


### Retired identifiers

Before rule scans, the gate checks for rule and script ids deleted from `.sloppatrol/rules/` or
`.sloppatrol/scripts/` and absent from the current tree. A current tracked file that still names one,
outside `.sloppatrol/reports/`, `.sloppatrol/runs/`, `.sloppatrol/ledger.json` and changelogs, produces
a `sloppatrol-retired-id` finding and exit 1. This stage is deterministic and does not mine history.

### Configuration

Each of these is exit 2, naming the file and line:

- a rule's `id` differs from its file stem, or an id repeats across rules, scripts and lenses;
- an id starts with `sloppatrol-`;
- `severity` is present and not `error`; `message` or `note` is missing;
- the gate cannot read one of the keys it parses: `id`, `severity`, `message`, `note`, `files` (a
  block or flow list of plain or quoted scalars) and `metadata.sloppatrol-scope` (`all` or `changed`,
  default `all`). The rest of the YAML is ast-grep's;
- `rule-tests/<id>-test.yml` is missing, or lacks at least one `valid:` and one `invalid:` case; a
  test file names an unknown id;
- a rule has `files:` and none of its globs matches a corpus path. Globs follow globset: `*` and
  `**` cross `/`; `?`, `[...]` and `{a,b}` are supported. `ignores:` is never checked;
- a script is not executable, has no `#!` line, or has no `sloppatrol-fix:` header; it lacks a test case
  with a non-empty `expected` and one with an empty `expected`;
- a script header in the first 40 lines names a `sloppatrol-<key>:` other than `sloppatrol-scope` (`all` or
  `changed`, default `all`), `sloppatrol-fix` and `sloppatrol-inputs`, or names one twice;
- a `sloppatrol-inputs:` header is empty, or one of its space-separated globs matches no corpus path;
- a corpus path contains a tab or a newline.

### Base

The base is needed only when a selected rule is changed-scope, or with `--all`. It is, in order:
the empty tree under `--all`; `--base REF`; `origin/$GITHUB_BASE_REF` when that is non-empty;
`origin/HEAD`.

It fails closed. Each of these is `sloppatrol-base`, exit 2, and the message names `--base` and
`fetch-depth: 0`:

- the ref does not resolve;
- the repository is shallow;
- `git merge-base HEAD <ref>` fails;
- `GITHUB_EVENT_NAME` is `pull_request`, `pull_request_target` or `merge_group` and the merge-base
  is HEAD.

The shallow check is skipped under `--all`, because the empty tree needs no history.

The changed set is `git diff --name-status -M25% <merge-base>` (the worktree against the merge-base,
so committed, staged and unstaged changes count; a type change counts as `M`) plus untracked files as
`A`. An ast-grep hit of a changed-scope rule counts only when its file has status `A`, `M`, or `R`
(new path). A changed-scope script receives the changed set and decides for itself, since a fact
about a changed file may land on one that did not change.

Outside a pull request or merge queue (a push to the default branch, a schedule), the default base
is HEAD's own branch, so changed-scope rules see nothing; run them with `--all` there when the
backlog matters.

### Output and exit codes

stdout lists each unsuppressed finding, sorted, as `path:line: <id> <message>`, then a `fix:` block
with one line per id that has findings (the rule's `note` or the script's `sloppatrol-fix`). A problem
that belongs to no file prints as `sloppatrol: <code> <message>`. stderr gets one summary line:

```
sloppatrol gate 0.3.0: N findings, S suppressed, R rules (A ast-grep, B script); ast-grep 0.44.1; base origin/main (merge-base 1a2b3c4d5e6f), K changed files; 7.1 s
```

Under `--fast`, `--fast: N scripts skipped; ` comes before the time.

When `GITHUB_ACTIONS` is `true` and `--json` is absent, stdout continues after the `fix:` block. Each
finding becomes a workflow command, `::error file=<path>,line=<line>,title=<id>::<message>`, with
`file` and `line` left out for a finding that belongs to no file. GitHub shows only the first ten
error annotations of a step, so a summary block follows that names every finding, one line per id
in id order:

```
=== sloppatrol findings: 3 ===
no-raw-sql (2): src/db.py:12 src/report.py:40
sloppatrol-script-test (1): sloppatrol
=== end sloppatrol findings ===
```

The block is absent when there are no findings. Its first and last lines are fixed, so a CI step
or a reader can cut the list out of a long log.

| Exit | Meaning |
|---|---|
| 0 | every stage ran and found nothing |
| 1 | findings: offenders, `sloppatrol-rule-test`, `sloppatrol-script-test`, or a marker code |
| 2 | the gate cannot run or is misconfigured: usage, ast-grep missing while rules exist, an ast-grep failure (below), a configuration error, `sloppatrol-base`, `sloppatrol-script-protocol` |

Rule tests run as `ast-grep test -c .sloppatrol/sgconfig.yml --skip-snapshot-tests`; its exit 4 becomes
`sloppatrol-rule-test` findings. The scan runs `ast-grep scan --json=stream --inspect entity` over the
corpus in chunks of 1000 paths. Each of these is an ast-grep failure, `sloppatrol-ast-grep`, exit 2, since
it would otherwise pass silently: an exit other than 0 or 1 (4 for tests), a stderr line starting
`ERROR`, an unparseable JSON hit, a test run whose `Running N tests` count differs from the number of
selected rules, a scan whose `effectiveRuleCount` differs from it (a `sgconfig.yml` that points
elsewhere), or a scan with a nonzero `skippedFileCount` (a source file ast-grep cannot decode).

### Fast mode

`--fast` is for a local check before pushing; CI runs the full gate. It drops work whose result
cannot change between the base and this branch:

- A rule's own tests run only when the branch touched the rule, its tests or `.sloppatrol/lib/` (or, for
  an ast-grep rule, `sgconfig.yml`).
- An ast-grep rule the branch did not touch scans only changed files (status `A`, `M`, or `R`),
  and its markers in other files are not checked as unused.
- A script with scope `all` and a `sloppatrol-inputs:` header is skipped when no path in the changed set
  (old and new paths, deletions included) matches one of its globs, unless the branch touched the
  script. Its markers are not checked as unused. Every other script runs as usual.
- A change to `.sloppatrol/gate.py` runs everything.

So `--fast` never drops a finding on a changed file. What it can hide is a finding the base
already had in a file the branch did not change, or one a script reaches through a file its
`sloppatrol-inputs:` leaves out. An incomplete `sloppatrol-inputs:` hides findings locally, never in CI.

### Script-rule protocol

The gate runs each script from the root with a 600 s timeout and these variables. Scripts run in
parallel on a thread pool, each with its own tests, so a script must not write files another
script reads:

| Variable | Value |
|---|---|
| `SLOPPATROL_ROOT` | absolute repository root, also the cwd |
| `SLOPPATROL_RULE` | the script's id |
| `SLOPPATROL_FILES` | path of a file listing the corpus, one path per line |
| `SLOPPATROL_BASE` | the merge-base SHA, or the empty tree under `--all`; set only when the base was resolved |
| `SLOPPATROL_CHANGED` | path of a file with one line per change: `A\tp`, `M\tp`, `D\tp` or `R\told\tnew`; set with `SLOPPATROL_BASE` |
| `SLOPPATROL_LIB` | absolute path of `.sloppatrol/lib` |

- **Output.** One offender per stdout line, `path:line: <id> <message>`, where `path` is in the
  corpus, `line` is at least 1 and `<id>` is `SLOPPATROL_RULE`. The line splits at its first `:<line>: `,
  so a message may quote other locations. A whole-file fact uses line 1.
- **Exit.** 0 with no lines passes; 1 with at least one line reports findings. Anything else is
  `sloppatrol-script-protocol` (exit 2): another exit code, exit 1 with no lines, exit 0 with lines, a
  malformed line, a foreign id, or a timeout. The gate runs the remaining scripts before exiting.
- **Ratchets.** A changed-scope script reads the base version with `git show "$SLOPPATROL_BASE:<old path>"`,
  taking the old path from the `R` lines; exit 128 means the file did not exist at base. It matches
  sites by line text, not line number.
- **Suppression.** Scripts never parse markers; the gate filters their output.
- A Python script imports shared helpers with `sys.path.insert(0, os.environ["SLOPPATROL_LIB"])`.

### Script tests

For each case directory `.sloppatrol/script-tests/<id>/<case>/`, holding `head/`, an optional `base/`
and `expected`, the gate:

1. creates a temporary git repository, isolated from the caller: git's repository-local variables
   (`git rev-parse --local-env-vars`, which a hook sets) are dropped, global and system config are
   off, and commits skip hooks;
2. commits `base/` when it exists;
3. makes the worktree exactly `head/`, deleting files that are in base but not in head, and commits;
4. runs the script under the protocol above with that repository as the root and `SLOPPATROL_BASE` set to
   the base commit, or the empty tree when there is no `base/`;
5. applies suppression, then compares the reported `path:line` set with `expected` (one `path:line`
   per line; blank lines are ignored).

A mismatch is `sloppatrol-script-test` (exit 1), listing the missing and extra entries.

## Project lenses

`.sloppatrol/lenses/<id>.md` uses the same four sections as the built-in lenses (**Defect**,
**Do not flag**, **Judgment**, **Output**) and is loaded by every audit. Write one when a class of
problem needs judgment specific to this codebase (a domain invariant, a framework's lifecycle).

## Agent instructions

`scripts/agents.py` is the reference implementation for this section. It is a Python 3.10+,
stdlib-only helper (`VERSION = "0.7.0"`); it never executes documented commands or fetches external content.

```sh
python3 skills/sloppatrol/scripts/agents.py check [--root DIR] [--json] [--max-lines N] [--max-skill-lines N]
```

- Root defaults to the Git toplevel containing cwd, or cwd without Git. Enumeration uses
  `git ls-files -co --exclude-standard -z -- .`, otherwise a filesystem walk. Both exclude
  `.git`, `node_modules`, `vendor`, `dist`, `build`, `.venv`, `target`, `__pycache__` directory
  components. Git-tracked files remain visible despite ignore patterns; tracked deletions are
  skipped. Nested `AGENTS.md` files get the same checks as the root.
- Required: a root `AGENTS.md`; introductory prose before the first H2, or under an opening H2
  named `Overview`, `Summary`, `Intro`, `Introduction`, or `About` (optionally prefixed `Project`);
  an H2 matching `command|check|gate|build|test|develop` containing a fenced block;
  and an H2 matching `rule|convention|boundar|constraint|gotcha`. Matches ignore case.
  Headings use ATX syntax (`#`); sections end at the next H1/H2. Comments and fenced examples do
  not supply headings or prose. Every file has a positive line budget, default 300; keep the root
  an index and link to details.
- Each directory with an enumerated `AGENTS.md` gets a root-to-directory byte budget, summing
  its ancestor instruction files and its own file in that order; siblings never combine.
  Count UTF-8 bytes, preserving original newlines and excluding whitespace-only files and
  assembly separators, as Codex does. Above 12 KiB (12288 bytes) emit a note; above Codex's
  default 32 KiB (32768 bytes), emit an error instead. Name the first H2 whose section loses
  content, plus the first H2 starting past the cut when different; ignore headings in fences
  and comments. Report the cut's line in the chain's last file, or line 1 if an ancestor already
  exhausts the budget. This checks enumerated `AGENTS.md` chains, not host instructions,
  `AGENTS.override.md`, fallback filenames, or custom Codex budget settings.

| Code | Severity | Meaning |
|---|---|---|
| `missing-root` | error | No root AGENTS.md |
| `missing-summary` | error | No introductory prose, including an opening overview/summary section |
| `missing-commands` | error | No matching commands H2 with a fence |
| `missing-gate` | error | `.sloppatrol/gate.py` exists but no fenced block in the root AGENTS.md runs it |
| `missing-rules` | error | No matching rules H2 |
| `over-budget` | error | File exceeds `--max-lines`, including blank lines |
| `over-bytes` | error | Root-to-directory instruction chain exceeds 32768 bytes; identifies the first affected H2 |
| `bytes-note` | note | Chain exceeds 12288 bytes but not 32768 bytes |
| `dead-link` | error | Relative Markdown destination does not exist |
| `dead-path` | error | Path-like inline code has no existing path/glob match |
| `dead-script` | error | Referenced script, target, recipe, or command path cannot be resolved |
| `tool-not-found` | note | Command executable absent from PATH and project ancestor `.venv` executable directories |
| `claude-md` | error | Sibling CLAUDE.md neither symlinks to AGENTS.md nor contains an `@AGENTS.md` line |
| `dead-skill` | error | Cited skill missing or its required frontmatter invalid |
| `skill-frontmatter` | error | A repository skill's frontmatter is missing or invalid, or exceeds the Agent Skills limits |
| `skill-over-budget` | error | A skill's `SKILL.md` exceeds `--max-skill-lines`, including blank lines |
| `skill-orphan` | error | A file under a skill's `references/`, `scripts/` or `assets/` that nothing in the skill cites |

### Skills

A skill is a directory holding a `SKILL.md` inside a directory named `skills`, directly or one
group below it: `.agents/skills/<name>`, `.claude/skills/<name>`, a plugin's `skills/<name>`, or
`skills/<group>/<name>`. Skills under
a `script-tests` or `rule-tests` directory are rule fixtures and are skipped. A symlink in a
`skills` directory to a skill directory inside the repository is checked once, through its
target; a target outside the repository is not checked. JSON lists the skill directories under `skills`.

- **Frontmatter** follows [Agent Skills](https://agentskills.io/specification) (verified 2026-10-13):
  the rules for `dead-skill` above, plus a `name` of 1-64 lowercase letters, digits and single
  hyphens, and a `description` of at most 1024 characters. Other fields are host-specific and not
  checked.
- **Budget:** `SKILL.md` is the entry point, loaded whole whenever the skill is; default 500 lines,
  the specification's recommended ceiling. Detail moves to files the entry point links.
- **Links:** every Markdown file in the skill gets the relative-link check above (`dead-link`).
  Prose paths and commands are not resolved: a skill names paths in other repositories, files its
  own tools create and import aliases, so their staleness is the `stale-docs` lens's call.
- **Reachability:** a file under `references/`, `scripts/` or `assets/` must be cited by another
  Markdown file in the skill: a relative link that resolves to it, its skill-relative path (alone or inside a longer path), by its
  path relative to the citing file, or by a directory below `references/`, `scripts/` or `assets/`
  that holds it. Other files (licences, host metadata) are not resources and need no citation.

### Path and command heuristics

- Links: inspect literal inline destinations and reference definitions, including unused
  definitions, outside fences/comments/inline code. Resolve against the instruction file's
  directory only; strip fragments, decode percent escapes and escaped parentheses/spaces.
  Strip source-location suffixes (`::symbol`, `:line`, `:line:column`, `:line-line`) from links
  and inline paths. Ignore schemes (including mailto and `@file://`), pure anchors, absolute paths
  and protocol-relative URLs.
  Common single-line links, optional titles, angle-bracket destinations and balanced destination
  parentheses are supported; this is not a full Markdown parser.
- Inline code outside link labels (a label is display text; the destination is checked): a path contains `/` or ends in one of `agents.py`'s `PATH_EXTENSIONS` (common
  source, config, documentation, image and archive extensions). Try the instruction directory,
  then root, then directories explicitly named earlier on the same line and the parent of a
  file linked earlier on that line. A linked `docs/topic/guide.md` also supplies the base for
  `topic/details.md`; context never carries to another line. Try each literal path before glob
  matching, so bracketed framework paths such as `app/docs/[[...slug]]/page.tsx` resolve literally.
  Otherwise `*`, `?`, `[]` and recursive `**` use filesystem glob matching; at least one existing
  file/directory must match. In a linked Git worktree, explicit `../` prose paths that leave the
  worktree may also resolve relative to the instruction's location in the primary checkout, as
  reported by `git worktree list --porcelain -z`. Only external sibling citations get this fallback;
  local paths, Markdown link destinations and executable command paths do not. A missing sibling
  still reports `dead-path`. Availability here proves a path exists, not its release or claim.
  Expand comma braces such as `{one,two}` (including nested braces); every expansion must resolve. Ignore
  brace lists containing `...` or the ellipsis character (U+2026), which are illustrative, not literal paths.
  Ignore whitespace, placeholders `<...>`, URLs/schemes, absolute
  paths, `-`/`~`/`$` prefixes, shell metacharacters, versions, and dotted identifiers with at least
  three components such as `a.b.c`. An ambiguous slash identifier with exactly one slash and no
  recognized extension is skipped unless its first component resolves to a directory; this
  includes service role identifiers. Leading `.` paths, trailing `/` directories and globs
  remain explicit. An adjacent prohibition (`no`, `no new`, `never/do not/don't add/create/introduce/use`)
  does not claim a file exists. Skip a path prefixed by a repository name explicitly introduced
  earlier on that line as a backticked name followed by `repo` or `repository`, for example
  "In the `client` repository, see `client/src/export.ts:12`." This is an unchecked upstream
  citation, not proof it resolves. Prefer a source permalink when the upstream is unavailable;
  unprefixed paths or context on another line are not inferred as external.
- Skill citations: inline paths or links to `.agents/skills/<name>/SKILL.md` or
  `.claude/skills/<name>/SKILL.md`, plus links to those skill directories, require an existing
  SKILL.md with frontmatter. Inline skill citations use the same explicit context and sibling
  fallback as other prose paths. Report `dead-skill` instead of a duplicate missing-path/link error.
  Frontmatter starts with `---`, closes with `---` or `...`, and has a non-empty string `name`
  equal to its directory and a non-empty string `description`. Literal plain/quoted scalars and
  `|`/`>` block scalars are supported; aliases, tags and collection-valued fields are not.
- Commands: inspect untagged or `sh`, `bash`, `shell`, `console`, `zsh` fences. Join backslash
  continuations, remove a leading `$ ` prompt, leading `A=b` assignments and unquoted trailing
  comments, then split unquoted `&&`, `||`, `;`, `|` (also background `&`) and drop redirections (`> out.log`,
  `2>&1`, `<in`), which name streams rather than targets or scripts. Honor shell quoting;
  skip placeholder lines, malformed quoting and segments starting with shell control words.
  Skip other fence languages and tree listings (branch-drawing characters or indented single-path
  entries under a directory). In untagged fences, skip contiguous pipe-table rows with a Markdown
  separator or ASCII table border; still inspect commands before/after the table. Label other
  tabular data and command output as `text` to avoid command inference. Each block starts in the
  instruction directory. A literal `cd` changes subsequent resolution; an unresolved `cd` skips the remainder of that block. This is static inspection, not shell
  evaluation; conditionals, substitutions, generated targets and includes are not resolved.
- `npm|pnpm|yarn|bun run <name>` checks the nearest ancestor package.json's `scripts`, stopping
  at root; `bun run` also accepts an existing file, which Bun runs directly. `make <target>` checks literal target names in the nearest GNUmakefile/makefile/Makefile
  (an existing file also counts); `just <recipe>` checks the nearest justfile/Justfile/.justfile.
  Only the first just recipe is checked because later words can be arguments. Make/just commands
  selecting another file/directory are skipped; dynamic names and assignments are skipped.
  Numeric make job/load option values are excluded from target names.
- `uv run <name>` accepts an exact project script name, a normalized dependency name, or an
  executable on PATH or in an ancestor `.venv/bin` or `.venv/Scripts`, stopping at root.
  Literal TOML extraction covers project scripts/gui scripts, project and optional dependencies,
  all dependency groups, legacy `tool.uv.dev-dependencies`, and Poetry
  scripts/dependency tables. Included-group labels are not executable names. Runner forms with
  options before `run` or before its name are not resolved.
- Relative command words and the first script argument to Python, Lua/LuaJIT, Node, Ruby and
  sh/bash/zsh use the path/glob and brace-expansion checks (including after `uv run`) against the
  block's current directory only, with no root fallback: that is where the command runs. The prose `owner/repo` and
  dotted-import exemptions do not apply to commands. Interpreter `-m`, `-c`, `-e`, `--eval` and
  `--command` forms are skipped. Other arguments are not treated as input files: they may name
  outputs. Unknown non-path command words produce notes, excluding shell builtins/control words
  and dynamic command words. Executables in ancestor `.venv/bin` or `.venv/Scripts` also count
  as available, stopping at root. Missing executables alone never fail the check.



## Report

An audit report is committed at `.sloppatrol/reports/<YYYY-MM-DD>.md`, or
`<YYYY-MM-DD>-<n>.md` when that date already has a report. Never overwrite a report. Use
[assets/report.md](../assets/report.md), and include the scope, gate before and after, open work,
carried-forward ledger items, slices and independence labels, confirmed items and guards, decisions,
bugs, gate loosening, gate growth and the next step. Build the Guard column from
`python3 <skill>/scripts/ledger.py list --json`, not by hand.
