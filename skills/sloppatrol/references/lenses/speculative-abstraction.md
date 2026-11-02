# speculative-abstraction

## Defect

Structure built for futures that have not arrived: an interface with one implementation, a factory
that makes one thing, a strategy or plugin layer with one strategy, configuration options nobody
sets, parameters every caller passes identically, wrapper layers that forward without adding
anything, "manager"/"helper"/"utils" indirection, and deep inheritance for a single variant.

## Do not flag

- Seams required by the runtime or framework (interfaces for mocks the project really uses at a
  boundary, extension points a plugin system documents).
- Public API kept stable for external consumers.
- An abstraction with one implementation today where a second is already in progress in the tree.

## Judgment

Name the second caller, implementation or configuration this abstraction exists for. If there is
none in the repository, what would the code look like without it, and is that simpler?

## Output

On the abstraction's definition. `what` names the single user or implementation; `why`
sketches the collapsed form.

## Safe move

Inline the pass-through, middle man or single-adapter seam at every call site and delete it, or add the second adapter (the fake) that makes the seam real.
