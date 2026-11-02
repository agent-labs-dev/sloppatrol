# Agents working on Sloppatrol

Sloppatrol is a TypeScript CLI whose agents make one verified refactor at a time, plus a skill and stdlib Python tools (a project-rules gate, a findings ledger and an AGENTS.md check) that repositories vendor.

## Commands

Before you finish, run:

```sh
pnpm check
pnpm knip
pnpm test
uv run --group dev pytest tests/python -q
uv run --group dev ruff check skills/sloppatrol/scripts tests/python
uv run --group dev ruff format --check skills/sloppatrol/scripts tests/python
python3 skills/sloppatrol/scripts/agents.py check
```

## Rules

- Read [CONTRIBUTING.md](CONTRIBUTING.md) before you change code: each folder in `src/` is a deep module, reachable only through its root files, and the tests use no mocking library.
- Use the words in [GLOSSARY.md](GLOSSARY.md). Do not re-decide what [docs/adr/](docs/adr/) records.
- The scripts in `skills/sloppatrol/scripts/` are standard-library Python 3.10 or later: repositories vendor them and run them in CI with nothing else installed.
