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

The scorecard also checks the repo's own guardrails, from files alone: an agent guide, strict types, a linter, module boundary rules, a pre-commit hook, CI and tests. Each one turns a wrong edit into a failed check. Sloppatrol reports a missing one; it never adds one itself, because tool configs are frozen.

Each commit gets a **scorecard** of the whole repo. A file keeps its scores while its content does not change, and each cycle scores up to `metrics.panel` more files: the most changed first, then the largest. So coverage grows each cycle until every file is scored, and the scorecard shows how much it covers. Every mean is weighted by lines. The surveyor starts from the worst scores, and each opportunity names the metrics it will raise. `sloppatrol score` scores the rest now, and opens the scorecard as a card to share; the dashboard shows the trend.
