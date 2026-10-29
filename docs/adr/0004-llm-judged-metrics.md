# ADR 0004 — Quality metrics judged by an LLM, blind and anchored

**Status:** Accepted
**Date:** 2026-10-29

## Context

"Cleaner code" must be measurable, or the patrol cannot aim, a reviewer cannot weigh a change, and a team cannot see a trend. Deterministic measures (lines, cyclomatic complexity, nesting) are consistent but miss what matters: concerns mixed in one module, hidden dependencies, tests that cannot fail, abstractions with no use. An LLM sees those, but its scores drift with wording, mood and bias toward "the change is better".

## Decision

Seven metrics, each judged per file as one of five anchored levels (0–4) against a fixed rubric, and shown to people as 0–100 (`src/metrics/lib/rubric.ts`): simplicity, modularity, injection (of dependencies), purity (state and effects), test quality, clarity, and agent-friendliness (how hard the file is to change wrong, and whether it is a pattern worth copying). Every name reads so that more is better, as the score does. The judge never picks a number on a 0–100 scale directly: five anchored levels are what keep two judges in agreement, and the percentage is only how a level, or a mean of levels, is shown. Each level is anchored in things a reader can point at, and the assessor must cite the lines behind each score. The rubric text has a version hash; scores under two versions are never compared.

- **Scorecard.** Each commit of the patrolled branch gets a scorecard of a fixed panel of files: the most changed and the largest. A file is scored once per content and rubric version (cached), so the trend moves only where code changed.
- **Proof.** Every refactor's changed files are scored before and after in one session, under neutral labels in random order, so the assessor cannot favour the new version. A panel of `metrics.judges` sessions (3 by default) scores at once, and each score is their mean: on a large file, one judge can swing a level, and the panel absorbs it. The target metrics the surveyor named must go up; no other metric may drop by more than `metrics.tolerance`.
- Code still measures what it can (lines, nesting, comments, mocks, suppressions) and gives it to the assessor as evidence, and to people as numbers.

## Consequences

A refactor that passes every check but is not measurably better is rejected. The rubric is data: improving it is a one-file change, and the version hash keeps old and new scores apart. Each scorecard and each proof costs an assessor session.
