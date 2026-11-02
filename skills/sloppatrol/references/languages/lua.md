# Lua (standard Lua, LuaJIT, Luau, game and editor add-ons)

Verified: 2026-09

## Contents

- [Detection signals](#detection-signals)
- [Toolchain by concern](#toolchain-by-concern)
- [Evidence commands the audit runs](#evidence-commands-the-audit-runs)
- [Looks dead but is live](#looks-dead-but-is-live)
- [ast-grep support](#ast-grep-support)
- [Pitfalls](#pitfalls)

## Detection signals

Look for `.lua`, `.rockspec`, `.luacheckrc`, `selene.toml`, `stylua.toml`, and
`.luarc.json`. Lua is usually embedded in a host (a game client, an editor such as
Neovim, a framework such as LÖVE), and the host defines the globals, load order and
entrypoints. World of Warcraft addons, the example used below, have `.toc` manifests, `.pkgmeta`, XML UI definitions, and
possibly flavor-specific manifests. Identify the actual runtime: WoW's Lua
environment, LuaJIT, standard Lua, and Luau do not have identical syntax or APIs.

## Toolchain by concern

| Concern | Recommendation and reason | Install |
|---|---|---|
| Format | StyLua; choose the runtime's syntax before formatting | `cargo install stylua --locked` |
| Lint | Luacheck for standard Lua/WoW; Selene where its standard-library model fits | `luarocks install luacheck`; alternatively `cargo install selene --locked` |
| Types | Lua Language Server diagnostics plus real host API annotations | `brew install lua-language-server` or upstream release binary |
| Tests | Busted where tests already use Lua; retain the addon's harness | `luarocks install busted` |
| Dead code | Luacheck unused locals plus manifest/callback tracing | same Luacheck install |
| Duplication | jscpd candidates, excluding vendored libraries | none; run on demand (see [generic](generic.md)) |
| Security/secrets | Gitleaks plus explicit host/network boundary review | `brew install gitleaks` |
| Dependencies | LuaRocks manifest review and pinned vendored/packager inputs | install LuaRocks for the runtime using the OS package manager |

[StyLua](https://github.com/JohnnyMorganz/StyLua) supports multiple syntax variants;
its Cargo defaults and release binary capabilities differ. Select features before
installing for LuaJIT/Luau. [Luacheck's maintained repository](https://github.com/lunarmodules/luacheck)
is under lunarmodules. Pin versions chosen during setup rather than floating in CI.

### Minimal configuration

For a Lua 5.1 addon, `stylua.toml` can start with:

```toml
syntax = "Lua51"
column_width = 110
indent_type = "Spaces"
indent_width = 4
```

Match the project's existing style (tabs or spaces) rather than these values. Set the runtime too:
LuaLS defaults to Lua 5.4, and on a LuaJIT/5.1 host that alone produces hundreds of false errors.

Start `.luacheckrc` narrowly, then enumerate the host's actual globals:

```lua
std = "lua51"
read_globals = { "CreateFrame", "UIParent" }
exclude_files = { "vendor/**" }
```

Do not globally disable undefined-global checks. Add named SavedVariables and
intentional exported globals with reasons. A minimal `.luarc.json` is:

```json
{"runtime.version": "Lua 5.1", "diagnostics.globals": ["CreateFrame", "UIParent"]}
```

One tool owns the undefined-global allowlist. Usually that is luacheck's `read_globals`; then
either keep `.luarc.json` `diagnostics.globals` in sync with it, or disable `undefined-global` in
LuaLS only and say so in the project skill. Two drifting lists are the common failure.

Real addons need host annotations; for WoW, [Ketho's vscode-wow-api](https://github.com/Ketho/vscode-wow-api).
They model the retail client: on Classic or other flavors expect false positives, and treat LuaLS as
evidence with a known-false-positive list rather than a gate.
Use Busted's existing `.busted` configuration, or its default `spec/` discovery.

### CI snippet

After installing pinned tools and the project's Lua runtime:

```yaml
- run: stylua --check .
- run: luacheck .
- run: busted
```

Add the host's smoke-test procedure to the project skill. Headless tests cannot
exercise protected UI interactions or every game-client lifecycle.
Use [generic checks](generic.md) for secrets, clones, and workflow validation.

## Evidence commands the audit runs

```sh
luacheck .
lua-language-server --check=. --checklevel=Warning --check_format=json --check_out_path=.sloppatrol/runs/evidence/luals.json
rg -n 'SavedVariables|OptionalDeps|Dependencies|\.lua|\.xml' -g '*.toc' .
rg -n '<Script|OnLoad|OnEvent|OnClick|<Binding' -g '*.xml' .
rg -n 'RegisterEvent|RegisterCallback|SetScript|SLASH_|SlashCmdList|_G\[' -g '*.lua' .
# shared tables: members defined vs read (luacheck cannot see across files). Set T to the addon's
# namespace table, and repeat for each module table that several files share.
T=ns
rg -o --no-filename "\\b$T(?:\\.|:)([A-Za-z_]\\w*)" -r '$1' -g '*.lua' -g '*.xml' -g '!types/**' . | sort | uniq -c \
  | awk '$1==1{print $2}' > .sloppatrol/runs/evidence/$T-once      # names that appear exactly once
```

Each name in `$T-once` appears once in the whole addon: usually its definition with no reader, or
a read of something defined elsewhere. Both are questions for the dead-code reviewer, not findings:
names used only inside their own file, and names reached by string (`$T[key]`), still need the
reachability paths. The command skips `types/`: a LuaLS annotation file that declares every member
would otherwise make each single use look like two. Exclude the project's own stub paths the same
way.

Create `.sloppatrol/runs/evidence/` first. LuaLS prints to stdout by default; the JSON flags write a
report, and it exits 1 whenever it reports anything, so read the report, not the exit code. Replace
`ns` with the addon's own table name.
The [LuaLS CLI reference](https://luals.github.io/wiki/usage/) documents these flags.
Luacheck unused-local warnings are candidates; names installed into shared tables
or consumed by host APIs need a separate reachability investigation.
Record which client flavor and manifest each evidence run covers.

## Looks dead but is live

- `.toc` file lists establish load order, including files never passed to `require`.
- XML `<Script>` inclusions, handlers, and `Bindings.xml` reference Lua globals.
- `_G`, shared addon tables, and callback registries connect independently loaded files.
- Event names and callback names are strings; search registration and dispatch contracts.
- SavedVariables names persist across sessions and may hold compatibility data.
- `SLASH_*` globals and `SlashCmdList` entries implement chat commands.
- Packager directives and flavor manifests can include files absent from a local run.
- Host methods called by name: methods of objects the host framework drives (data providers,
  UI modules, mixins) and `OnLoad`-style XML handlers.
- `.toc` directives change timing: with `LoadSavedVariablesFirst: 1` saved data exists before the
  files run, so `x = x or {}` may be real defaults rather than defensive noise.
- Headless test harnesses that load files with `loadfile`/`setfenv` are callers too.
- Code reached only through the addon's init path (`ns.Init`, `ADDON_LOADED`) is invisible to specs
  that never run it. Prove liveness with a stub harness that loads the files in `.toc` order and
  records what gets hooked or registered.

## ast-grep support

Lua appears in ast-grep's [supported languages](https://ast-grep.github.io/reference/languages.html).
Use `Lua` in native YAML rules. Check the installed parser against the target dialect;
support for Lua does not establish Luau or WoW API semantics. Validate every rule with
native valid/invalid examples before using it as a gate.

## Pitfalls

The host ships helpers that count as the platform for `reinvented-wheel` (WoW's FrameXML:
`tContains`, `tIndexOf`, `CopyTable`, `Mixin`), but their presence varies by client flavor: check
the target flavor before replacing hand-rolled code. Every root-level file ships in the addon zip unless the packager ignores it: add new config files
(`ruff.toml`, `.luarc.json`, tool directories) to `.pkgmeta` `ignore:` (dot-files are usually pruned
already, but check). Turning a global into a `local` needs the definition to precede every use in load
order. Do not remove global writes because local-name search finds no reader. Never reorder
manifest entries as formatting. Stubbed host APIs can conceal load-order bugs and
taint restrictions. Review clone hits in embedded libraries against their upstream
update process. [Busted](https://lunarmodules.github.io/busted/) is a Lua test framework,
not an emulator for the game client; keep the distinction visible in coverage reports.
