# Python

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Look for `.py`, `.pyi`, Python shebangs, `pyproject.toml`, requirements files,
`uv.lock`, `setup.cfg`, and CI interpreter matrices. Read the supported Python
versions before picking tools. A package, a notebook collection, and a standalone
script need different import roots; preserve the existing layout.

## Toolchain by concern

| Concern | Recommendation and reason | Install |
|---|---|---|
| Format | Ruff formatter; shares configuration with lint | `uv add --dev ruff` |
| Lint | Ruff correctness rules; expand after checking the existing diagnostics | same Ruff install |
| Types | ty for a new configuration; retain mypy/pyright where plugins or established checks matter | `uv add --dev ty` |
| Tests | pytest, using the project's actual test commands | `uv add --dev pytest` |
| Dead code | Vulture as reachability candidates, including tests and scripts | `uv add --dev vulture` |
| Duplication | jscpd for candidate locations; see [generic tooling](generic.md) | none; run on demand (see [generic](generic.md)) |
| Security/secrets | pip-audit for dependency advisories; Gitleaks for secrets | `uv add --dev pip-audit`; `brew install gitleaks` |
| Dependencies | uv lock/sync plus scheduled dependency updates | `python3 -m pip install uv` |

Use [Ruff's installation guide](https://docs.astral.sh/ruff/installation/)
and [ty's configuration reference](https://docs.astral.sh/ty/reference/configuration/).
Check type-checker compatibility on real modules before replacing an established checker.
Lock the selected versions; installations above are setup commands, not CI steps.

### Minimal configuration

Merge into `pyproject.toml`; set the Python target to the project's minimum. For standalone scripts
with no manifest, the same settings go in a `ruff.toml` beside them. Always select rules explicitly:
unconfigured Ruff uses its release's defaults, which move.

```toml
[tool.ruff]
line-length = 110
target-version = "py310"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.vulture]
paths = ["src", "tests"]
min_confidence = 80
```

ty discovers the project environment; add `[tool.ty.environment]` only when
the import roots/interpreter need explicit configuration. Vulture paths must
include real directories; a flat project may use its package directory instead.
Do not generate a blanket allowlist to make the initial evidence run quiet.

### CI snippet

After a SHA-pinned checkout and setup-uv, with the supported interpreter selected:

```yaml
- run: uv sync --locked
- run: uv run --no-sync ruff check .
- run: uv run --no-sync ruff format --check .
- run: uv run --no-sync ty check
- run: uv run --no-sync pytest
- run: uv run --no-sync pip-audit
```

The audit command above inspects the synced environment, including installed
development dependencies. Validate advisory exceptions against exact versions.
Run Gitleaks and jscpd as described in [generic tooling](generic.md).
These snippets assume their optional tools were added and locked during setup.

## Evidence commands the audit runs

```sh
uv run ruff check .
uv run ty check
uv run pytest --collect-only -q
uv run vulture src tests --min-confidence 80 --sort-by-size
rg -n 'entry-points|\[project.scripts\]|__all__|getattr|import_module' .
rg -n 'pytest_plugins|@.*fixture|@.*route|register' src tests
```

Use the paths discovered during setup, including operational scripts and migrations.
[Vulture](https://github.com/jendrikseipp/vulture) reports unused names, not a proof
that external callers do not exist. Compare production-only and test-inclusive runs
to identify test-only code. Collection output identifies implicitly used fixtures.
Ruff/type diagnostics provide reproducible facts; review fixes separately for behavior.
Read duplicate blocks in context before deciding whether they share a contract.

## Looks dead but is live

- Packaging entry points and console scripts reference callable names as strings.
- Framework decorators register routes, tasks, commands, and serializers on import.
- `__all__`, re-exports, and documented imports form public API boundaries.
- `getattr`, import hooks, plugin discovery, and metadata entry points bypass direct calls.
- pytest fixtures, parametrization ids, and `conftest.py` hooks are loaded indirectly.
- ORM migrations and serialization hooks may run outside the main application.
- Pickled names can be compatibility obligations even after their last source caller moves.

## ast-grep support

Python is in ast-grep's [built-in language list](https://ast-grep.github.io/reference/languages.html).
Install the pinned `ast-grep-cli` ([setup, section 6](../setup.md#vendor-the-gate)), then test rules against both
the defect and legitimate syntax. Structural matches do not resolve imports or prove
runtime reachability. Use `ast-grep --help` for the installed version's commands.

## Pitfalls

Do not treat import-time side effects as unused expressions. Excluding generated
code is sensible only when its generator and consumers remain covered. A checker
running against the wrong virtual environment can manufacture missing imports.
Keep [uv's lockfile workflow](https://docs.astral.sh/uv/guides/projects/) reproducible;
do not run dependency upgrades as part of an unrelated cleanup. Follow
[pip-audit's scope](https://github.com/pypa/pip-audit) when interpreting security results.
