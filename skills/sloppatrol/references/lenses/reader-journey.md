# reader-journey

## Defect

Human documentation leaves its intended reader unable to choose, complete or recover from a
supported task. Missing prerequisites, unexplained branch choices or placeholders, unsafe copyable
examples, unrecognisable success, unsupported recovery advice and inaccessible instructions count
when they cause a concrete failure. Essential text lost from MDX components or alternate outputs
is a delivery defect even when the source builds.

## Do not flag

- Reference or explanation pages for lacking tutorial steps unrelated to their purpose.
- Warnings or prerequisite facts repeated at independent entry points.
- Exact UI names, consistent technical vocabulary, real uncertainty and migration version history.
- Clearly labelled illustrative output, with no claim it was observed or guaranteed.
- A supplementary colour/position cue when the control also has a usable name.
- Agent instructions, prompts or marketing as if they were human task guides.
- Surface differences that preserve the task's meaning and reading order.

## Judgment

Follow [the human-docs workflow](../docs.md). State the reader and goal, then walk the path using
supported-version evidence. Can the reader start, select the right branch, act, recognise success
and take a supported next step on failure? Check rendered and supported alternate outputs. Identify
the exact missing or inaccessible fact; do not invent a universal section template or a new feature.

## Output

On the step or component that needs to change. `what` quotes it and identifies the blocked task;
`why` names the evidence, affected output and smallest complete correction. A missing fact is
anchored to the step that needs it. Unsupported claims belong to `stale-docs`. New or published copy
follows the audit's `decide` route unless its edit is authorised.

## Safe move

Add the missing fact at the step that needs it, or fix the step, without inventing a template or a feature.
