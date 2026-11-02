# Choosing a toolchain for an unlisted language

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Start with inventory output, manifests, shebangs, build files, lockfiles, and CI.
Confirm the language, dialect, runtime versions, generated sources, supported
platforms, and package boundaries by reading the repository. Ask which commands
contributors actually run only when repository evidence leaves a material gap.
Preserve a working toolchain unless a replacement closes a demonstrated gap.

## Toolchain by concern

Research the compiler/runtime's official documentation first, then maintained
community-standard tools. Confirm releases, supported versions, and CI behavior
at setup time; popularity alone is not enough. Use this selection matrix:

| Concern | Preferred source | Minimal configuration and verification |
|---|---|---|
| Format | Official formatter, otherwise established community formatter | use existing style; check-only run on representative files |
| Lint | Compiler warnings and ecosystem-standard linter | choose correctness rules; confirm a real diagnostic |
| Types | Native compiler/type checker | match import roots, versions, and target matrix |
| Tests | Existing runner and framework conventions | collect real tests and execute a meaningful subset |
| Dead code | Ecosystem reachability analyzer | enumerate all entry roots; keep results advisory initially |
| Duplication | jscpd or an ecosystem-native clone detector | exclude vendor/generated output; inspect candidates |
| Security/secrets | Maintained advisory scanner plus Gitleaks | scan the actual lockfile/environment and repository history |
| Dependencies | Existing package manager and updater integration | commit locks; verify frozen/reproducible installation |
| Prose | markdownlint-cli2; Vale with a published style (Google, Microsoft, write-good) | lint real docs only; exclude changelogs and generated reference |

For each selected tool, record its upstream link, exact version, install command,
config file, working directory, check command, successful exit code, and coverage
limits in the project skill. Use `<tool> --help` when a flag is uncertain. Replace
that placeholder with the discovered executable; do not invent a plausible flag.

### Shared tool installation

These are setup examples; resolve versions once, then pin the tested artifacts:

Evidence tools run on demand and should not become dependencies of a project in
another language. Run them without installing into the project:

```sh
npx --yes jscpd@4 --silent --reporters json --output .sloppatrol/runs/evidence/jscpd .
uvx zizmor .github/workflows
npx --yes markdownlint-cli2 "**/*.md" "#node_modules"
```

Gate tools that CI runs are installed as CI steps, pinned to an exact version or a
checksum-verified release binary (`gitleaks`, `actionlint`, `hadolint`). ast-grep is pinned as in
[setup, section 6](../setup.md#vendor-the-gate). In a JavaScript project, `jscpd` may instead be a
dev dependency, invoked through `npx --no-install` or a package script. The gate calls
`ast-grep`, never `sg`, which is often an unrelated system executable.

### Minimal shared configuration

For a project with maintained source and generated/vendor directories, `.jscpd.json`:

```json
{
  "ignore": ["**/vendor/**", "**/node_modules/**", "**/dist/**", "**/.sloppatrol/**"],
  "reporters": ["console", "json"],
  "output": ".sloppatrol/runs/evidence/jscpd"
}
```

[jscpd](https://github.com/kucherenko/jscpd) reports token overlap. Do not turn its
default clone sizes into an automatic design verdict or a percentage threshold.
Gitleaks can begin with its built-in rules; add narrow exceptions only for verified
fixtures. Keep secret values redacted in logs and saved reports.

### CI snippet

After a SHA-pinned checkout, full history for historical scanning, and pinned tools:

```yaml
- run: actionlint
- run: zizmor --offline .github/workflows
- run: gitleaks git --redact --no-banner .
```

Run actionlint/zizmor only when GitHub Actions exists. Add `hadolint Dockerfile`
when Dockerfiles are present. Native format/lint/type/test checks need concrete
commands verified in the target project; do not fill their gap with a no-op job.
[zizmor integration](https://docs.zizmor.sh/integrations/) supports offline checks
without granting workflow write permissions.

## Evidence commands the audit runs

```sh
git ls-files -co --exclude-standard
npx --yes jscpd@4 --silent --reporters json --output .sloppatrol/runs/evidence/jscpd .
npx --yes jscpd@4 --min-lines 3 --min-tokens 30 --silent --reporters json --output .sloppatrol/runs/evidence/jscpd-small .
gitleaks dir --redact --no-banner .
python3 .sloppatrol/gate.py --all
```

- The default jscpd thresholds find large clones only; the small-clone pass finds the short copied
  blocks that drift, at the cost of more noise.
- Evidence output goes under `.sloppatrol/runs/evidence/`, so `.sloppatrol/runs/*.json` holds review envelopes
  only.
- Generated data (encoded blobs, baked tables) trips secret scanners: allowlist those paths
  explicitly rather than lowering the scanner's sensitivity. Use
  [Gitleaks](https://github.com/gitleaks/gitleaks) directory mode for the current tree and git mode
  for history.
- Always give `rg` a path (and `--hidden` to include `.github/`): with no path and a non-TTY stdin
  it reads stdin and hangs.
- The gate runs the project's ast-grep and script rules with their tests; plain `ast-grep scan`
  shows hits the gate suppresses.
- Record command failures and coverage limits separately from findings; missing tools never imply
  cleanliness. Clone and dead-code results are locations to investigate, not verdicts.

## Looks dead but is live

Rule out the six reachability paths in [dead-code](../../references/lenses/dead-code.md), open work
included. Search manifests and loader configuration, inspect registries, read consumer docs,
and exercise representative entry points. Repeating name searches is not additional
evidence. Serialization, migrations, cleanup, compatibility, and metrics can be
load-bearing even when ordinary application callers are absent.

## ast-grep support

Check the [current supported-language list](https://ast-grep.github.io/reference/languages.html)
and installed `ast-grep --help`. Confirm the exact grammar/dialect and file mapping.
For an unsupported language, evaluate documented custom grammars or use the native
linter. Structural parsing alone cannot establish runtime reachability or semantics.
Every rule needs both a real failing example and legitimate passing examples.

## Pitfalls

Try the proposed tool on a tiny known-good and known-bad fixture before wiring CI.
Inspect its exit behavior and report format, not just its ability to start. Verify
licenses, maintenance, runtime support, and installation reproducibility from
upstream sources. Record an unresolved concern as a gap instead of fabricating a
tool or check. Avoid blanket ignores, overlap between tools, and silent fallback
commands that make an incomplete review look clean.
