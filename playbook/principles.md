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
14. **A split makes a folder.** When one module becomes several, the concept gets a directory: its entry file sits at the root, the parts sit inside, and the old file becomes that entry or disappears. An entry that names the concept's public parts is its interface, not sediment. Never leave the old file as the anchor with prefixed siblings beside it (`orders.ts`, `orders_validation.ts`, `orders_helpers.ts`).
15. **A move takes the whole concept.** Every function, type and constant of the concept moves in the same change. A move that leaves part of the concept behind gives it two owners, which is worse than one large owner.
16. **Parse at the boundary, once.** A value that arrives untyped (network, IPC, files, env, storage, user input, `JSON.parse`) is decoded into a typed value by one schema idiom where it enters. Past that point the type is trusted: no casts, no re-validation downstream. Ids get their distinct type at the entry and keep it everywhere; internal code never falls back to a plain string. A bound is a named constant, never read back out of a schema.
17. **Failures are typed values.** An expected failure is a named, typed error that callers handle by its name, apart from a broken invariant. A vendor call is wrapped once, in its adapter, and its failure is mapped there. Every failure that is dropped on purpose says why in a name, never in silence.
18. **Hosts discover; they never import features.** A shell, router, settings page or registry reads a catalog that each feature joins (by registration or by a file name the host looks for). New work then adds files instead of editing a shared root, and a lifecycle that touches every feature (sign-out, reset, shutdown) is a registry each feature joins, not a list that imports them all.
19. **Dependencies point inward.** Features import shared code; shared code imports no feature; two features never import each other. Where they do, move the shared part into the one that owns it, or pass it in as an argument.
20. **A rule a check can decide is a check.** A convention that a lint rule, a type or a script can hold is held by it, and its failure message names the fix. Prose is for what no tool can decide. An exception sits on the line, names its rule, and says the contract that makes it safe and the condition that retires it.

## Where to spend effort

- Start where code changes often. A refactor pays off when people will touch that code again.
- Fix the shape, not the symptom. A small behaviour change that needs a large diff shows a shape defect.
- Do not over-weigh the existing architecture. If behaviour is pinned by tests, the shape underneath can change.
- Shrink the debt the repo already measures. When the repo has a budget, a ratchet, a list of known violations that may only shrink, or suppressions with a reason, work that retires an entry comes first: the repo has already decided it wants it gone.
- Respect the decision records of the repo. Propose against one only when the friction is real, and say so.
