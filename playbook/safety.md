# Safety

A Sloppatrol refactor never changes what the code does. Code checks this, not trust. Know the gate before you change anything.

## The gate

A refactor is kept only when all of these pass. No agent can overrule a failure.

1. **One side.** A source refactor changes no test file, so the existing tests prove the behaviour held. A test refactor changes no source file, so the unchanged source proves the tests are right.
2. **Frozen files.** No manifest, lockfile, tool config, CI file, snapshot, environment file or ignored path changes.
3. **No suppression.** No added lint or type suppression, `any` cast, coverage exclusion, or skipped or focused test.
4. **Tests kept.** The diff removes no test case, and changes no test file that no check runs.
5. **Size.** The diff stays within the file and line limits. A large diff is a sign of a shape fight, not a feature.
6. **Checks.** Every check of the repo (typecheck, lint, tests, build) passes on the refactor, as it passed on the base commit.
7. **Review.** A reviewer agent reads the diff and can reject it.

## Behaviour that must not change

- Return values and outputs, for every input, including edge cases: empty, null, undefined, zero, negative, very large, unicode.
- Side effects, their order, and their count: writes, network calls, logs that someone reads, events, metrics.
- Errors: their types, messages that callers match, and the conditions that raise them.
- The public interface for callers outside the repo: exported names, signatures, default values, HTTP routes, CLI flags, environment variables, file formats, serialized field names, database schema.
- Timing that callers rely on: sync versus async, eager versus lazy, the moment a value is read.
- Module load side effects and their order.

## Safe moves

- **Move a pure function**: move it, export it from the new owner, update every import, delete the old one. No re-export of the old path.
- **Extract**: copy the lines into a new named function, call it from the old place, run the checks, then simplify.
- **Inject a dependency**: add an optional parameter with the current concrete value as the default; use it in place of the direct reference. Remove the default later, in its own change, once every caller passes it.
- **Introduce a port**: define the interface from what the consumer already calls. Make the existing class satisfy it without changes. Type the consumer's parameter as the port.
- **Split a file**: move one cohesive group of declarations at a time. Keep the public entry point's exports identical.
- **Rename**: rename the symbol and every reference in one change, including docs and agent instructions. Persisted keys and external contracts keep their names.
- **Delete dead code**: prove it is dead first: no reference in the repo, not exported to outside callers, not reached by reflection, routing tables, dependency-injection containers or string lookups.

## Stop and change nothing when

- The opportunity needs a behaviour change, or a change to both source and tests at once.
- The code has no test that exercises it (propose `characterize` in the summary instead).
- The change would touch a frozen file.
- You cannot prove a name is unused outside the repo.
