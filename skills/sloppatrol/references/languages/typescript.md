# TypeScript and JavaScript

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Look for `.ts`, `.tsx`, `.js`, `.jsx`, `.mts`, `.cts`, `.mjs`, `.cjs`, `package.json`,
`tsconfig*.json`, package-manager locks, and workspace definitions. Identify Node,
browser, framework, and bundler boundaries. Use the repository's package manager;
the examples below use npm and assume tools are already in the local lockfile.

## Toolchain by concern

| Concern | Recommendation and reason | Install |
|---|---|---|
| Format | Biome for supported files; retain Prettier for required unsupported formats | `npm install --save-dev --save-exact @biomejs/biome` |
| Lint | Biome defaults, or Oxlint for a dedicated linter; keep needed ESLint plugins | `npm install --save-dev oxlint` when chosen |
| Types | TypeScript compiler with project configs, including JS checking if adopted | `npm install --save-dev typescript @types/node` |
| Tests | Existing runner; Vitest fits many Vite/TS projects | `npm install --save-dev vitest` when needed |
| Dead code | Knip models entry files, exports, scripts, and dependencies | `npm install --save-dev knip` |
| Duplication | jscpd reports clone candidates | `npm install --save-dev jscpd` |
| Security/secrets | npm audit for the lockfile; Gitleaks for source/history | npm includes audit; `brew install gitleaks` |
| Dependencies | Existing lockfile plus grouped scheduled updates | `npm ci` installs the committed npm lock |

Verify the runtime requirements in [Knip's setup guide](https://knip.dev/overview/getting-started).
Do not run multiple overlapping linters without assigning each a purpose. Review
[Biome's supported setup](https://biomejs.dev/guides/getting-started/) and
[Oxlint's compatibility guidance](https://oxc.rs/docs/guide/usage/linter.html)
before replacing plugins that encode project-specific contracts.

### Minimal configuration

A small `biome.json` uses defaults without depending on a schema-version URL:

```json
{
  "formatter": {"enabled": true},
  "linter": {"enabled": true, "rules": {"recommended": true}},
  "vcs": {"enabled": true, "clientKind": "git", "useIgnoreFile": true}
}
```

Merge `"strict": true` and `"noEmit": true` into the appropriate TypeScript
checker config after measuring the existing diagnostics; do not replace framework-generated
configs. Start Knip with plugin discovery; add `knip.json` only for missing roots:

```json
{"entry": ["src/index.ts"], "project": ["src/**/*.ts", "src/**/*.tsx"]}
```

That config is for a small library. Applications need routes, workers, scripts,
and framework plugins instead of one guessed entry. Preserve test roots too.
Vitest can use the existing Vite configuration when appropriate; run its discovery
on real tests before changing CI. Keep ESLint configuration if plugins need it.

### CI snippet

After a pinned checkout and the project's Node/package-manager setup:

```yaml
- run: npm ci
- run: npx --no-install biome ci .
- run: npx --no-install tsc --noEmit
- run: npx --no-install vitest run
- run: npm audit
```

Use the established test script instead when the project uses another runner.
For a chosen Oxlint stack, replace the Biome lint step with the verified lint
command and retain one formatter check. Knip initially belongs in evidence;
only proven, stable checks should become a required project gate.

## Evidence commands the audit runs

```sh
npx --no-install knip
npx --no-install tsc --noEmit
npx --no-install jscpd src --reporters console,json --output .sloppatrol/runs/evidence/jscpd
rg -n '"exports"|"bin"|"main"|"types"|"scripts"|"sideEffects"' -g 'package.json' .
rg -n 'import\(|import.meta.glob|require\(|register|worker' src
```

Knip's unused exports/files/dependencies are candidates relative to its discovered
entries. Check framework plugin diagnostics and workspace boundaries before acting.
Compare package exports with consumer-facing documentation. Clone reports identify
textual overlap; distinct serialization or routing contracts may justify similarity.
Capture each command's exit code rather than interpreting a failed install as clean.

## Looks dead but is live

- `package.json` exports, `bin`, conditional exports, and declaration files form API.
- Dynamic imports, glob imports, and lazy-loaded chunks can be selected by strings.
- File-based routes, server actions, middleware, and framework conventions imply callers.
- Bundler/test configuration names setup files, loaders, transforms, and workers.
- Side-effect imports install polyfills or register custom elements and plugins.
- Browser globals, service workers, native bridges, and external scripts cross the tree boundary.
- Published packages have consumers outside the workspace; local search cannot enumerate them.

## ast-grep support

The [built-in list](https://ast-grep.github.io/reference/languages.html) includes
JavaScript, TypeScript, and Tsx; choose the correct grammar. Vue/Svelte embedded
scripts need verified language injection/configuration rather than assuming a TS
rule scans the whole component. Use `ast-grep --help` and test the installed parser.

## Pitfalls

Deleting an apparently unused import can remove side effects. Do not collapse
client/server module boundaries or change export shapes as cleanup. Build outputs,
generated declarations, and vendored assets need explicit exclusions with their
sources covered. A different tsconfig, environment condition, or package export map
can make code reachable even when the default build does not include it.
