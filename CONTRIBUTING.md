# Contributing

```bash
pnpm install
pnpm build
pnpm test
pnpm check   # Biome, module boundaries, types
pnpm knip
```

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

Run the **Release** workflow from `main` in GitHub Actions, and pick `patch`, `minor` or `major`.

- The workflow runs the checks and the tests, bumps the version from the newest `v*` tag, and publishes to npm.
- npm trusts the workflow through OIDC, so no npm token is stored. The trusted publisher names `release.yml` and the `npm` environment.
- The release commit lives only on its `v*` tag, and the workflow opens a GitHub release for it.
