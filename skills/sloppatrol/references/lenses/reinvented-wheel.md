# reinvented-wheel

## Defect

Hand-rolled code for something the standard library, the platform, or a dependency the project
already has does properly: retry loops, argument parsing, path joining, date arithmetic, deep copy,
debounce/throttle, URL building, CSV/JSON handling, string padding, set operations, a homemade
event bus or cache.

## Do not flag

- Replacing it would add a **new** dependency for a small gain; note it only if the project already
  depends on a library that does it.
- The runtime genuinely lacks the facility (embedded interpreters, game clients, restricted
  sandboxes, old language versions the project supports). Check the project's minimum version.
- The custom version exists for a stated reason (performance, determinism, a platform bug).

## Judgment

Is there a facility already available to this project, at its supported versions, that does exactly
this, and would using it lose any behaviour the custom code deliberately provides?

## Output

On the first line of the hand-rolled code. `what` names the existing facility; `why`
names any behaviour difference that must be preserved or checked.

## Safe move

Replace the hand-rolled code with the standard library or a dependency the project already has.
