# Smells

Each smell is a heuristic, never a verdict. The format: what it is → the safe move. Most come from Fowler's *Refactoring* and Ousterhout's *A Philosophy of Software Design*.

## Shape

- **Shallow module**: an interface almost as large as its implementation; a class whose methods each forward to one call. → Merge it into its caller or into the module it wraps, behind a smaller interface.
- **Pass-through**: a function or layer that only renames or forwards. → Inline it at every call site and delete it.
- **God file**: one file that registers routes, holds rules, talks to the database and formats output. → Split it along the concepts it owns; the original thins to composition.
- **Divergent change**: one module changes for several unrelated reasons. → Split it so each part changes for one reason.
- **Shotgun surgery**: one logical change needs edits in many files. → Gather what changes together into one module.
- **Information leak**: two modules share knowledge of one format or rule, so a change to it touches both. → Give the knowledge one owner; the other module asks it.
- **Deep import**: code imports another module's internal file. → Import from the module's entry point; export the name there if it belongs in the interface.

## Dependencies

- **Hidden dependency**: `new Client()`, a global, a singleton, `process.env`, the clock or randomness used inside logic. → Inject it through a parameter or constructor; the composition root creates the real one.
- **Concrete coupling**: logic depends on a concrete adapter where only a few of its methods are needed. → Define a small port, owned by the consumer, with only those methods.
- **Speculative seam**: an interface with one implementation and no test that injects another. → Inline it, or add the second adapter (the fake) that makes it real.
- **Middle man**: a class that mostly delegates to another. → Call the real target directly.
- **Message chain**: `a.b().c().d()` across modules. → Hide the walk behind one method on the first object.

## Data and types

- **Primitive obsession**: a string or number stands in for a domain concept (ids, money, units, states). → Give the concept its own type.
- **Data clump**: the same few values always travel together. → Bundle them into one type.
- **Boolean or string mode flag**: a parameter that selects which of two behaviours runs. → Split into two functions, or use a union type the callee matches on.
- **Optional fields valid only together**: `data?` and `error?` on one object. → A union of states.
- **Repeated switch**: the same `switch` on the same type in many places. → One module owns the union and its branches.

## Code

- **Long function**: more than a screen, or several levels of nesting. → Extract named steps; guard clauses for early exits.
- **Duplicated code**: the same logic shape in two places. → Extract the shared shape and call it from both. Do not merge code that only looks alike but changes for different reasons.
- **Mysterious name**: a name that does not say what the thing is or does; `data`, `info`, `handle`, `manager`, `utils`, `helper`, `v2`. → Rename it; if no honest name comes, the design is murky.
- **Feature envy**: a function that uses another object's data more than its own. → Move it to the data.
- **Dead code**: unused exports, parameters, branches, flags, files. → Delete them, with their tests' fixtures but never their test cases of live code.
- **Comment that explains a confusing line**: → Rename or restructure until the comment is not needed. Keep comments that say why.

## Tests

- **Mock of own code**: a mocking library patches the team's own module. → Seam plus fake (see testing.md).
- **Implementation-coupled test**: asserts on calls, call counts or private state. → Assert on observable outcomes through the interface.
- **Tautological test**: the expected value is computed the way the code computes it. → Use a literal or a worked example.
- **Untested hot spot**: a file that changes often and has no test. → `characterize` first.
