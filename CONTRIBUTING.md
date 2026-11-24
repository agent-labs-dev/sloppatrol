# Contributing

```bash
pnpm install
pnpm build
pnpm test
pnpm check   # Biome, module boundaries, types
pnpm knip
```

## TypeScript

`tsc` is TypeScript 7, installed as `@typescript/native`. TypeScript 7 ships no compiler API, and dependency-cruiser parses `.ts` files through that API, so the `typescript` package name points at `@typescript/typescript6`, the TypeScript 6 API that Microsoft publishes for tools. Without it `pnpm lint:boundaries` skips every `.ts` file and passes on nothing. Fold the two back into one `typescript` once dependency-cruiser supports the TypeScript 7 API.

## Shape of the code

Sloppatrol follows its own [playbook](playbook/principles.md).

- Each folder in `src/` is a deep module. Its root files (`index.ts`) are its interface. Its subfolders are private: `lib/` holds the implementation and `tests/` holds its tests.
- A module imports another module only through that module's root files. `pnpm lint:boundaries` (dependency-cruiser) fails on a deep import, on a cycle, and on any import of `src/cli/`.
- `src/cli/` is the only composition root: it alone picks the real adapters (the `gh` GitHub, the agent runtimes) and wires them.
- External systems sit behind a port with two adapters. GitHub has `GhCliGitHub` and `FakeGitHub`; the agent runtime has the CLI and model runtimes, and the tests run a scripted agent CLI.

## Tests

- Test through a module's root files, like any other caller.
- No mocking library. Use real git repos in a temp folder, real processes, the in-memory `FakeGitHub`, and the scripted agent in `src/patrol/tests/fake-agent.mjs`.
- Assert on outcomes: saved records, the pull requests the fake received, the files in a worktree.

## Release

A release is one click: **Actions → Release → Run workflow** on `main`, picking `patch`, `minor` or `major`.

Add each change's entry under `## [Unreleased]` in `CHANGELOG.md`, in the PR that makes it. The release job bumps the newest `vX.Y.Z` tag, takes the Unreleased entries that tag did not ship, runs the checks and the tests, publishes to npm, then pushes a `release: sloppatrol vX.Y.Z` commit as the `vX.Y.Z` tag and opens a GitHub release whose notes are those entries.

- `main` takes only signed, reviewed PRs, so the release commit lives only on its tag. `package.json` on `main` keeps an older version, and released entries stay under Unreleased there; the tag's `CHANGELOG.md` has them under their version.
- The job fails without publishing when no Unreleased entry is new since the last tag.
- npm trusts the workflow through OIDC, so no npm token is stored. The trusted publisher names `release.yml` and the `npm` environment, which accepts deployments from `main` and `v*` tags.
- A rerun is safe until the tag is pushed: it finds the version already on npm and skips the publish. If only `gh release create` failed, create that release by hand instead of rerunning, which would bump again.
