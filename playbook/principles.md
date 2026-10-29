# Principles

These rules apply to every repo, in every stack. The repo's own written rules win where they disagree.

## Vocabulary

Use these words exactly. They come from Ousterhout, Feathers and Matt Pocock's `codebase-design` skill.

- **Module**: anything with an interface and an implementation: a function, a class, a file, a folder, a package.
- **Interface**: everything a caller must know to use the module: types, invariants, order of calls, errors, configuration, cost.
- **Implementation**: the code behind the interface.
- **Depth**: how much behaviour a caller gets per unit of interface it must learn. A **deep** module hides a lot behind a small interface. A **shallow** module has an interface almost as complex as its implementation.
- **Seam**: a place where behaviour can change without an edit in that place. The interface of a module lives at a seam.
- **Port**: an interface at a seam, owned by the code that consumes it.
- **Adapter**: a concrete thing that satisfies a port: the Postgres repository, the HTTP client, the in-memory fake.
- **Leverage**: what callers get from depth. **Locality**: what maintainers get from depth: change, bugs and knowledge stay in one place.

Do not say "boundary", "service" or "component" as a general word for a module.

## The rules

1. **Deep modules.** A module hides much behind little. Before you add or keep a module, apply the **deletion test**: imagine you delete it. If its complexity disappears, it was a pass-through: inline it. If the complexity reappears in many callers, it earns its place.
2. **One concept, one owner.** Each concept (a rule, a state machine, a data contract, a format) has exactly one module that owns it. Duplicated owners drift. One module that owns many unrelated concepts must split along those concepts.
3. **Pure functions first.** Keep decisions apart from effects (I/O, time, randomness, mutation, UI). Write the logic as pure functions: same input, same output, no side effects, so a test needs values alone. Prefer immutable data and functions that return new values over code that mutates. A thin layer at the edge does the effects.
4. **Single responsibility.** A module changes for one reason. When a file changes for many unrelated reasons, split it so that each part changes for one.
5. **Accept dependencies; do not create them.** Code that needs a database, a clock, a network client or a file system receives it through a parameter or a constructor. Only the composition root (the `main`, the server bootstrap, the app root) creates real adapters and wires them together.
6. **Talk through interfaces.** A module uses another module only through that module's interface: its entry points, never its internal files. A port belongs to the consumer and contains only what the consumer needs.
7. **Real seams only.** One adapter is a hypothetical seam. Two adapters (production and test) make a real seam. Do not add a port that nothing varies across.
8. **Small files, clear names.** Keep a file to one responsibility, usually under 300 lines. A name says what a thing is today, never where it came from (`v2`, `new`, `legacy`, `helper`, `utils`, `manager`).
9. **No sediment.** A refactor replaces the old shape. It does not leave wrappers, aliases, re-exports or "temporary" branches beside the new shape. Every caller moves in the same change.
10. **Every line is debt.** Delete dead code, unused parameters, unused exports and guards that no caller can trigger. Prefer the platform and the standard library to custom code.
11. **Errors are part of the interface.** Do not swallow errors. Do not widen or narrow what a module throws without a reason.
12. **Types tell the truth.** Make illegal states unrepresentable: unions for states, distinct types for ids and units. Never escape the type system to make code compile.
13. **Make it hard to change wrong.** Agents and new people copy what they see and trust what passes. Give each job one obvious pattern, make the interface enforce correct use (required parameters, exhaustive matches, distinct types), and turn every invariant you can into a check that fails fast. A file worth copying is a guardrail in itself.

## Where to spend effort

- Start where code changes often. A refactor pays off when people will touch that code again.
- Fix the shape, not the symptom. A small behaviour change that needs a large diff shows a shape defect.
- Do not over-weigh the existing architecture. If behaviour is pinned by tests, the shape underneath can change.
- Respect the decision records of the repo. Propose against one only when the friction is real, and say so.
