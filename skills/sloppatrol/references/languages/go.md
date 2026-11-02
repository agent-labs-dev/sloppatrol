# Go

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Look for `.go`, `go.mod`, `go.sum`, `go.work`, `.golangci.*`, and CI GOOS/GOARCH
matrices. Read the module's Go/toolchain directives and build constraints. Inventory
every workspace module, binaries under `cmd/`, generated code, and cgo inputs.
Record the actual deployment platforms before treating one build as representative.

## Toolchain by concern

| Concern | Recommendation and reason | Install |
|---|---|---|
| Format | gofmt; the language's standard formatter | bundled with Go |
| Lint | golangci-lint v2 with its standard configuration, including Staticcheck | `brew install golangci-lint` or verified upstream binary |
| Types | Go compiler for each supported build configuration | install the Go version declared by the project |
| Tests | `go test`; race testing where runtime/platform support allows | bundled with Go |
| Dead code | Go's deadcode reachability analyzer; Staticcheck for local unused code | `go install golang.org/x/tools/cmd/deadcode@latest` |
| Duplication | jscpd as a candidate list, with generated files excluded | none; run on demand (see [generic](generic.md)) |
| Security/secrets | govulncheck for reachable vulnerable calls; Gitleaks for secrets | `go install golang.org/x/vuln/cmd/govulncheck@latest`; `brew install gitleaks` |
| Dependencies | Go modules plus scheduled updates and checksum verification | bundled with Go |

The [golangci-lint installation guide](https://golangci-lint.run/docs/welcome/install/local/)
recommends its binary distribution over ad hoc source builds. Match its build Go
version to the target language version. Resolve `@latest` once during setup, then
record exact versions for CI. Avoid changing the project's module dependencies
merely to install an audit tool.

### Minimal configuration

For a new golangci-lint v2 configuration, `.golangci.yml` can start with:

```yaml
version: "2"
linters:
  default: standard
```

Do not copy v1 configuration keys into v2. Run `golangci-lint config verify` and
`golangci-lint linters` with the installed release. Add checks only after examining
their reports against the project's generated files and platform conventions.
gofmt and the Go compiler require no separate config. Keep version/build settings
in `go.mod`, `go.work`, build tags, and the project's recorded commands.

### CI snippet

After installing the pinned Go toolchain and verified linter binary:

```yaml
- run: go mod download
- run: go mod verify
- run: test -z "$(gofmt -l .)"
- run: golangci-lint run
- run: go test ./...
```

Restrict the formatter input to maintained source if the tree contains vendor or
generated code. Run from each module root when a workspace command does not cover
all modules. Add `go test -race ./...` only on supported runners, and preserve the
existing platform/tag matrix. See [generic tooling](generic.md) for shared checks.

## Evidence commands the audit runs

```sh
go list ./...
go build ./...
go vet ./...
deadcode ./...
deadcode -test ./...
govulncheck ./...
rg -n '//go:build|//go:generate|//go:linkname|//export|func init\(' -g '*.go' .
rg -n 'reflect\.|Register|plugin.Open|Lookup' -g '*.go' .
```

[deadcode](https://pkg.go.dev/golang.org/x/tools/cmd/deadcode) starts from executable
entry points. A library-only module needs real consumer roots or test executables;
an inability to find a main package is not a clean result. Compare the two deadcode
runs to distinguish code used solely by tests. Repeat for supported build tags and
platforms before reaching a deletion decision. Inspect errors as well as findings.
[govulncheck](https://go.dev/doc/security/vuln/) narrows dependency advisories by use,
but does not replace application-specific security review.

## Looks dead but is live

- `init` functions and blank imports register drivers and handlers through side effects.
- Reflection, interface satisfaction, and registries obscure direct call sites.
- Build tags and GOOS/GOARCH suffixes select implementations absent from one build.
- cgo `//export` declarations and C callers create entry points outside Go search.
- Public package functions can have consumers in other repositories.
- `//go:linkname`, assembly declarations, and generated glue connect names unusually.
- Serialization tags, templates, and plugin lookup can refer to fields or names indirectly.

## ast-grep support

Go is in the [supported language list](https://ast-grep.github.io/reference/languages.html).
Use `Go` rules for syntactic contracts. ast-grep is not a replacement for type-aware
analysis, interface method-set checks, or the build-tag matrix. Include legitimate
generated-style and receiver variants in each native rule's valid cases.

## Pitfalls

An unused function can still satisfy an interface or constitute public API.
Never remove blank imports just because their package name is absent below them.
Do not use `go mod tidy` as proof a runtime dependency is unnecessary: inspect its
diff and test every supported configuration. Generated sources should be changed
through their generator, with regeneration and consumer checks recorded together.
Avoid interpreting clone size as permission to merge distinct protocol handlers.
