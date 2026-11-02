# Shell

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Inspect `.sh`, `.bash`, `.zsh`, and extensionless executable shebangs, plus scripts
embedded in Makefiles, CI, Dockerfiles, and package-manager commands. Distinguish
POSIX sh, Bash, dash, ksh, zsh, and fish. A `.sh` filename does not override its
actual interpreter. Record supported operating systems and external commands.

## Toolchain by concern

| Concern | Recommendation and reason | Install |
|---|---|---|
| Format | shfmt for its supported dialects | `go install mvdan.cc/sh/v3/cmd/shfmt@latest` |
| Lint | ShellCheck for supported shells; dialect-native checks otherwise | `brew install shellcheck` or OS package |
| Types | No general static type system; syntax checks and explicit argument contracts | interpreter already required by the project |
| Tests | Existing harness; Bats for Bash integration behavior | `brew install bats-core` |
| Dead code | ShellCheck unused assignments plus caller/config investigation | same ShellCheck install |
| Duplication | jscpd candidates with generated wrappers excluded | none; run on demand (see [generic](generic.md)) |
| Security/secrets | Gitleaks, ShellCheck, and trust-boundary review | `brew install gitleaks` |
| Dependencies | Inventory external binaries and pin images/tool versions in CI | use the existing OS/tool manager |

[ShellCheck](https://github.com/koalaman/shellcheck) and
[shfmt](https://github.com/mvdan/sh) have different dialect support. Check the
installed release's help before applying either to zsh, fish, or an embedded
script. Pin the version resolved during setup; avoid a floating install in CI.

### Minimal configuration

Prefer shebang-based dialect inference. A Bash-only tree can use `.shellcheckrc`:

```ini
shell=bash
```

Omit that override in a mixed-shell tree. Describe sourced file paths with
ShellCheck source directives only when they reflect the real execution layout.
Keep exceptions local, and explain the invariant behind each exception.

Use `.editorconfig` for the shell formatter's common indentation settings:

```ini
[*.sh]
indent_style = space
indent_size = 2
```

Check `shfmt --help` for the installed version's discovery and dialect options.
Bats' default test files end in `.bats`; use the existing project's test directory.
There is no useful universal empty type-checker or dead-code configuration here.

### CI snippet

For a repository whose maintained Bash sources are under `scripts/`:

```yaml
- run: shfmt -d scripts
- run: shellcheck scripts/*.sh
- run: bats tests
```

Replace the glob with an explicit discovered file list when scripts are nested,
extensionless, or mixed-dialect. A glob matching nothing must fail visibly.
Add `bash -n` or the target shell's syntax check for each script. CI should use
the actual minimum shell version, not only the runner's newest installed shell.
Use [generic checks](generic.md) for workflow syntax, secrets, and clone evidence.

## Evidence commands the audit runs

```sh
shellcheck scripts/*.sh
shfmt -d scripts
bash -n scripts/check.sh
rg -n 'source |\. |trap |eval |bash |sh ' .github scripts Makefile
rg -n 'command -v|which |curl |wget |mktemp|rm ' scripts
```

The concrete check.sh name above is an example: enumerate real files first.
ShellCheck diagnostics are localized candidates; an assignment can be consumed by
a sourced file, child process, or indirect expansion. Trace those contracts before
deletion. Search CI, cron/systemd inputs, container entrypoints, and package scripts
for callers. A text search miss does not account for operators invoking scripts.
Formatting output is a diff to inspect, not a behavioral equivalence proof.

## Looks dead but is live

- Sourced files export functions and variables into their caller's shell.
- Traps, completion functions, hooks, and shell startup files have implicit entry points.
- `eval`, indirect expansion, and command names stored in variables bypass direct references.
- Exported variables are consumed by external programs and subprocesses.
- CI, cron, systemd, container entrypoints, and manually documented commands call scripts.
- Generated wrappers and aliases can select commands dynamically.
- Positional arguments, file descriptors, and environment variables form public contracts.

## ast-grep support

Bash appears in the [supported languages](https://ast-grep.github.io/reference/languages.html).
That does not imply fish/zsh support or automatic extraction of shell embedded in
YAML. Test the installed parser on the actual dialect. A native ShellCheck rule or
explicit shell test is usually preferable for shell semantics.

## Pitfalls

Do not casually add `set -e`, `set -u`, or `pipefail`: each changes error behavior.
Preserve quoting, word splitting, globbing, redirection order, and pipeline status.
Here-documents can contain other languages or literal suppression examples; inspect
them as data. Avoid executing deployment scripts merely to check syntax. Tests
should use isolated directories and controlled commands instead of real services.
No unused-variable diagnostic alone proves an exported variable can be removed.
