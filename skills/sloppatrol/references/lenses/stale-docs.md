# stale-docs

## Defect

Documentation makes an unsupported or contradicted claim about the relevant product or code:
paths, symbols, commands, flags, defaults, permissions, availability or behaviour. Also docs that
describe the same thing twice and disagree. Applies to human docs and concrete references in
agent instruction files; model-read text keeps its separate edit/eval boundary.

## Do not flag

- Changelogs, release notes and ADRs that accurately describe their stated version or past decision.
- Plans explicitly labelled as plans, without promising current availability.
- Comments in code: `comment-narration` owns those, stale ones included.
- A claim supported for its stated scope just because another client or release differs.

## Judgment

Follow each reference to its authoritative source. For human docs, use [the evidence workflow](../docs.md):
split compound claims and check the relevant released client/artifact, service configuration,
permissions and rollout. Current code and command help alone do not prove shipped behaviour.
Distinguish a contradicted claim from one whose evidence is unavailable; neither permits an
invented replacement. Retain supported task facts when narrowing an unsupported claim.

## Output

On the affected line. `what` quotes the claim; `why` records its scope, evidence location,
verification method and contradiction or missing proof. A source inspection is not an execution
result. Missing task steps or lost output text belong to `reader-journey`. Follow the audit's
edit permissions, including `decide` for new or published copy unless authorised.

## Safe move

Correct the doc to match what the code does now. The code is not changed to match the doc.
