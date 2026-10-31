# The metrics


An assessor agent scores each file against a fixed rubric, and cites the lines behind each score. For each metric it picks one of five anchored levels, and Sloppatrol shows the result as 0 (worst) to 100 (best): a level of 3 is 75. A scorecard also shows one **overall** score, the mean of all metrics. The rubric anchors every level in things a reader can point at, so scores stay consistent ([ADR 0004](adr/0004-llm-judged-metrics.md)).

| Metric | The question |
| --- | --- |
| Simplicity | Can a reader follow each function without holding much in their head? |
| Modularity | Does the file own one concept, behind a small interface, apart from other concerns? |
| Injection | Does the code receive what it depends on, or reach out for it? |
| Purity | How much of the logic lives in pure functions (same input, same output, no side effects), with state and effects kept small and at the edge? |
| Test quality | Do the tests prove behaviour through the interface, and would they fail if it broke? |
| Clarity | Does every name, comment and abstraction earn its place? |
| Agent-friendliness | How hard is it for an agent to change this file wrong, and is it a pattern worth copying? |

The scorecard also checks the repo's own guardrails, from files alone: an agent guide, strict types, a linter, module boundary rules, CI and tests. Each one turns a wrong edit into a failed check. Sloppatrol reports a missing one; it never adds one itself, because tool configs are frozen.

**Strict types** passes when every language with at least 10% of the code files (tool config files such as `vite.config.ts` aside) has a check that rejects a wrong type:

| Language | Counts as strict |
| --- | --- |
| Rust, Go, Swift, Kotlin, Java, C# | Always: the compiler checks types. For Rust the evidence also names a clippy gate (`[lints.clippy]` in a `Cargo.toml`, or `cargo clippy ... -D warnings` in CI) when there is one; it is not required. |
| TypeScript | Every `tsconfig*.json` that compiles files resolves to `"strict": true`, following local `extends` and `@tsconfig/strictest`. A solution file with `"files": []` is skipped. |
| JavaScript | A strict `tsconfig` or `jsconfig` sets `"checkJs": true`. JSDoc types alone are not detected. |
| Python | A mypy, pyright or ty config, in any `pyproject.toml`, `setup.cfg`, `mypy.ini` or `pyrightconfig.json`. Whether it runs in strict mode is not checked. |
| Ruby | A Sorbet (`sorbet/config`) or Steep (`Steepfile`) config. |

Any other language fails with "no type checker this census can detect", so a miss always names the language and why.

The **pre-commit hook** is shown for information, with what it runs, and is not scored. A fast hook that runs what CI runs helps; a slow one (tests, a build) or one that rewrites files gets skipped with `--no-verify` or stalls an agent committing in a worktree. CI is the gate that counts, so a missing hook is not a gap either.

Each commit gets a **scorecard** of the whole repo. A file keeps its scores while its content does not change, and each cycle scores up to `metrics.panel` more files: the most changed first, then the largest. So coverage grows each cycle until every file is scored, and the scorecard shows how much it covers. Every mean is weighted by lines. The surveyor starts from the worst scores, and each opportunity names the metrics it will raise. `sloppatrol score --files 200` scores more now; the dashboard shows the trend.
