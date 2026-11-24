# Sloppatrol

A team of agents that patrols a repository and opens small, behaviour-preserving refactor pull requests, each verified
by the target repo's own checks. Sloppatrol is a patrol only: it never vendors or runs a rules gate in a repository.
Read [CONTRIBUTING.md](CONTRIBUTING.md) before you change code, use the words in [GLOSSARY.md](GLOSSARY.md), and do not
re-decide what [docs/adr/](docs/adr/) records.

## Commands

- `pnpm install --frozen-lockfile`, then `pnpm gate`: biome, module boundaries, types, knip and the tests.
- `pnpm gate:changed`: the same, linting only files changed against `origin/main` and running the tests they reach.
- `pnpm build` compiles to `dist/`. CI also runs `actionlint` and `zizmor --offline .github`.
- Release: one click on the Release workflow, from Unreleased entries in `CHANGELOG.md` (see `CONTRIBUTING.md`);
  publishing needs explicit authorization.

## Invariants

- Each folder in `src/` is a deep module reachable only through its root files; `pnpm lint:boundaries` fails a deep
  import, a cycle, and any import of `src/cli/`, the only composition root.
- External systems sit behind a port with a real and a fake adapter. Tests use no mocking library: real git repos in a
  temp folder, real processes, `FakeGitHub`, and the scripted agent in `src/patrol/tests/fake-agent.mjs`.
- `tsc` is TypeScript 7 (`@typescript/native`); the `typescript` name is the TypeScript 6 API that dependency-cruiser
  needs. Do not fold them together (see `CONTRIBUTING.md`).

## Standards

- `repo-standards`: the RS-* requirements every cjber and agent-labs-dev repo meets; its `audit.py` checks this repo.
