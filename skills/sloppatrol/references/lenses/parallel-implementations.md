# parallel-implementations

## Defect

Two or more implementations of the same concept that have drifted apart or will: two functions
that parse the same format, two copies of a validation, two caches of the same data, a "v2" living
beside the "v1" it replaced, a closed set of values restated in several places (a list, a map, a
switch, a schema). The cost is not the duplicate lines; it is that the next fix lands in one copy.

## Do not flag

- **Coincidental similarity**: code that looks alike but changes for different reasons and belongs
  to different owners. Merging it couples things that should move independently.
- Deliberate divergence with a stated reason (a hot path specialised for speed, a sandboxed copy
  that must not import the main one).
- Generated code, vendored code, test fixtures, and small idioms (a two-line guard, a loop shape).
- Clone-detector hits you have not read. Token similarity is evidence, not a finding; semantic
  duplicates with different tokens are the ones that matter most.

## Judgment

If a bug were fixed or a rule changed in one of these copies, would the others need the same change
to stay correct? If yes, which one is the canonical home?

## Output

One finding per duplicate, on the non-canonical copy. `what` names every copy (file:line) and the
canonical home; `why` lists the differences between the copies and whether each is
accidental drift or intentional.

## Safe move

Keep one canonical home, move every caller to it, delete the rest. Do not merge code that only looks alike but changes for different reasons.
