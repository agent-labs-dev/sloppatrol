# Rust

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Look for `.rs`, `Cargo.toml`, `Cargo.lock`, `rust-toolchain.toml`, `.cargo/config.toml`,
`build.rs`, and CI target/feature matrices. Separate application crates from public
libraries and proc-macro crates. Read the minimum supported Rust version and
workspace membership before choosing a toolchain or checking all features.

## Toolchain by concern

| Concern | Recommendation and reason | Install |
|---|---|---|
| Format | rustfmt; stable toolchain formatter | `rustup component add rustfmt` |
| Lint | Clippy for compiler-aware diagnostics | `rustup component add clippy` |
| Types | `cargo check` across supported targets/features | Cargo and rustc via the project's Rust toolchain |
| Tests | Cargo tests, including documentation tests | bundled with Cargo |
| Dead code | compiler diagnostics plus cargo-machete for unused dependency candidates | `cargo install cargo-machete --locked` |
| Duplication | jscpd for locations requiring semantic review | none; run on demand (see [generic](generic.md)) |
| Security/secrets | cargo-audit for RustSec advisories; Gitleaks for secrets | `cargo install cargo-audit --locked`; `brew install gitleaks` |
| Dependencies | Cargo lockfile and grouped updates; cargo tree for dependency explanation | bundled with Cargo |

Use [Clippy's documented workflow](https://doc.rust-lang.org/clippy/usage.html).
Match toolchain components to the project's pinned toolchain. Install external
Cargo tools at explicit versions after setup validation, and record them in the
project skill. Avoid adding nightly-only tools to a stable project without a need.

### Minimal configuration

A small `rustfmt.toml` may specify:

```toml
max_width = 110
```

Keep edition and minimum Rust version in the existing Cargo manifests. Clippy
defaults are sufficient for a first pass; add `clippy.toml` only for a real project
constraint. For example, a verified MSRV setting can be `msrv = "1.85.0"`, but
replace that value with this project's actual minimum.

[cargo-machete](https://github.com/bnjbvr/cargo-machete) may need an explicit exception
for a dependency referenced solely by generated code. Document the exact generator:

```toml
[package.metadata.cargo-machete]
# build.rs generates code referencing this runtime crate.
ignored = ["prost"]
```

Do not add this example unless the package actually generates prost code.
Prefer renaming metadata to an ignore when a dependency's crate import name differs.

### CI snippet

After installing the project's pinned toolchain and components:

```yaml
- run: cargo fmt --all -- --check
- run: cargo check --workspace --all-targets --locked
- run: cargo clippy --workspace --all-targets --locked -- -D warnings
- run: cargo test --workspace --locked
```

The warning gate assumes the existing checks are clean. Add project-supported
feature/target combinations rather than blindly enabling mutually exclusive
features. Run cargo-audit with its pinned version and documented advisory policy.
See [generic tooling](generic.md) for secret scanning and duplication evidence.

## Evidence commands the audit runs

```sh
cargo check --workspace --all-targets --locked
cargo machete
cargo tree --duplicates
cargo audit
rg -n '#\[cfg|cfg!|macro_rules!|proc_macro|no_mangle|export_name' -g '*.rs' .
rg -n 'include!|OUT_DIR|build-dependencies|\[features\]' -g '*.rs' -g 'Cargo.toml' .
```

Compiler dead-code diagnostics are relative to the selected build. cargo-machete
scans dependency usage; generated code and optional features require verification.
Its optional metadata mode can affect lockfiles, so inspect its help and diff before
adopting it. Duplicate crate versions from `cargo tree` are dependency evidence,
not source clones or automatic permission to force a single version.
[cargo-audit](https://github.com/RustSec/rustsec/tree/main/cargo-audit) checks known
advisories; absence of advisories is not proof that unsafe code is sound.

## Looks dead but is live

- Public library APIs may be used only by downstream crates outside this repository.
- Macros and proc macros generate references not obvious in source text.
- `cfg` flags, optional features, target triples, and test builds change reachability.
- `build.rs` and `include!` produce code and environment-dependent bindings.
- FFI symbols, exported names, link sections, and registration macros have external callers.
- Trait implementations can satisfy bounds without an obvious named method call.
- Doctests and examples exercise public entry points that a default source scan may miss.

## ast-grep support

Rust is a [built-in language](https://ast-grep.github.io/reference/languages.html).
Structural rules inspect source syntax, not expanded macros or all conditional
compilations. Use native valid/invalid fixtures and keep compiler checks as the
authority for type and ownership constraints.

## Pitfalls

Never equate `pub` with unused merely because no in-tree caller exists. Removing
`Drop`, cleanup, or cancellation paths can change observable behavior. Preserve
feature defaults, panic behavior, ordering, and API shapes during cleanup. A single
`--all-features` run may be invalid for the crate and cannot replace supported build
combinations. Exclusions for generated files must retain their producing inputs.
