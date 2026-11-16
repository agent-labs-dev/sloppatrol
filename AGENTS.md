# Agents working on Sloppatrol

Read [CONTRIBUTING.md](CONTRIBUTING.md) before you change code: each folder in `src/` is a deep module, reachable only through its root files, and the tests use no mocking library. Use the words in [GLOSSARY.md](GLOSSARY.md). Do not re-decide what [docs/adr/](docs/adr/) records.

Before you finish, run `pnpm check`, `pnpm knip` and `pnpm test`.

## Commands

- Setup: `pnpm install --frozen-lockfile`.
- Fast gate: `pnpm check` and `pnpm knip`.
- Build: `pnpm build`. Tests: `pnpm test`.
- Workflows: `actionlint` and `zizmor --offline .github`.
- Release: see `CONTRIBUTING.md`; publishing requires explicit authorization.

## Standards

This repository follows the `repo-standards` pack (RS-* ids).
