---
name: sloppatrol-project
description: "Project skill for sloppatrol in <PROJECT>: the exact quality-gate and evidence commands, live roots that must never be deleted as dead code, exclusions, conventions and risk order. Load before running sloppatrol or any code-quality, cleanup or dead-code work in this repository."
---

# sloppatrol project skill: <PROJECT>

<!-- Written when you set up Sloppatrol. Keep it factual: every command here has been run and works.
     Update it whenever an audit learns something (a live root, a false-positive source). -->

<One paragraph: what this project is, its runtime, and how it is consumed.>

## Gate

Run in order from the repository root. All must pass (exit 0) before and after any audit slice.
Commands live in code blocks, not tables, so pipes need no escaping.

```sh
<format check>
<lint>
<type check>
<tests>
python3 .sloppatrol/gate.py --base origin/<default branch>   # project rules; `uv run python .sloppatrol/gate.py` in a uv project
```

ast-grep pin: <`ast-grep-cli==0.44.1` in the dev dependency group, or `uv tool install
ast-grep-cli==0.44.1` in CI; "not needed" while `.sloppatrol/rules/` is empty>.

## Evidence

On-demand tools for audits. Output is candidates, never verdicts.

```sh
<dead-code command>
<duplication command>
```

Known false positives:

- <tool>: <e.g. handlers registered by name in X>

## Live roots

Things reached indirectly. The dead-code lens must treat these as referenced.

- <manifest / registry / naming convention>: <how it reaches code>
- <other repository>: <what it consumes from this one: a package export, a file path, an API>

## Model-read text

Text a model reads is behaviour, not prose. Audits never edit it as cleanup; they record a `decide`
item for the owner.

- `<path or glob>`: <prompts / tool and parameter descriptions / schema docstrings / model-visible
  enum values>; validated by `<project check>`

## Human documentation

Keep this section when the project has human docs; otherwise write "none".

- Readers and goals: <audience, canonical entry points and supported clients/versions>
- Evidence: <release artifacts, service/configuration/rollout sources and policy authority>
- Outputs: <Markdown/MDX renderer, text-bearing component props, supported alternate exports>
- Checks: <existing commands and coverage: syntax, links/anchors, metadata, components, rendered
  interaction/accessibility and exported text; gaps explicitly named>
- Semantic review: <claim evidence and reader walkthroughs still needed beyond those checks>

## Zones

How each part of the tree is reviewed. Unlisted paths are `production`.

| Path | Zone | Reason |
|---|---|---|
| `<path>` | <production / script / test / fixture / config / docs / generated / vendor> | <why> |

## Conventions

- <naming, layout, error-handling and comment conventions this codebase visibly follows>

## Risk order

Audit slices from lowest to highest risk:

1. `<path>`: <why>

## Settled

Shapes that look like defects here but are not. Reviewers and verifiers read this before raising a
finding; audits add an entry when verifiers keep dismissing the same shape for the same reason.

- <shape> (<lens>): <why it is fine here>, e.g. `<path>`

## Anti-patterns

Shapes this codebase has produced more than once and a reviewer confirmed. Check new code against
them. An audit guards a confirmed defect of one of these shapes with `settled:<name>`, which the
ledger checks against these names. An entry leaves when a rule enforces it or it has not recurred in
two audits.

- **<name>**: <shape> (<lens>), e.g. `<path>:<line>`

## Project rules and lenses

- Rules already owned elsewhere (not duplicated in `.sloppatrol/`): <tests in the project's suite and
  linter rules that pin a structural fact, one line each, or "none">
- ast-grep rules: `.sloppatrol/rules/` (<n>): <one line each, or "none yet">
- Script rules: `.sloppatrol/scripts/` (<n>): <one line each, or "none yet">
- Lenses: `.sloppatrol/lenses/`: <one line each, or "none yet">
