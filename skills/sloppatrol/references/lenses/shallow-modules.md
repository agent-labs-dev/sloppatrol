# shallow-modules

## Defect

Modules whose interface is nearly as large as what sits behind it, so the callers carry work the
module should own: every caller repeats the same sequence of calls, threads the same context
through, or handles the same errors; one concept is spread across several small modules that only
make sense read together and always change together; logic was extracted into pure helpers for
testing while the defects live in how callers combine them; tests patch internals because the
interface cannot reach the behaviour.

## Do not flag

- A layer with nothing behind it. That is `speculative-abstraction`: the fix is to inline it.
- A file mixing unrelated responsibilities. That is `oversized-modules`: the fix is a split.
- A seam something really varies across: two adapters in the tree, or a boundary the framework or
  a public API requires.
- Small modules that change independently of each other.
- Code nobody changes. Depth pays off where change happens, so a shallow module in a file
  untouched for a year is not worth a finding.
- Plumbing only tests repeat, with one production caller. That is `test-plumbing`.

## Judgment

Delete the module in your head. If the complexity vanishes, it was a pass-through and belongs to
another lens. If the same complexity reappears in each caller, name the callers and the steps they
repeat: how much of that would disappear behind a smaller interface?

## Output

On a line of the interface callers depend on. `what` names the callers and what each repeats;
`why` says what would move behind the interface, without designing it. Audits never deepen a
module: where the seam goes is a design choice, so one a verifier confirms is recorded `decide`,
and the patrol's `deepen-module` opportunity is the route that works it.

## Safe move

Merge it into its caller or into the module it wraps, behind a smaller interface. Where the seam goes is a design choice: propose `deepen-module`.
