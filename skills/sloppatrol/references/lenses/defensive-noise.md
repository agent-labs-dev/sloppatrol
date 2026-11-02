# defensive-noise

## Defect

Checks and handlers that guard against things the program's own contracts already rule out:
re-validating values the type system or a previous layer already validated, null checks on values
that cannot be null, `try`/`catch` around code that cannot throw that error, catch-all handlers that
log and continue, redundant `isinstance`/`typeof` checks on trusted internal data, and error paths
nothing can reach. Noise hides the checks that matter and swallowed errors hide real failures.

## Do not flag

- Validation at a **trust boundary**: user input, network, files, environment, IPC, third-party APIs,
  deserialised or persisted data, plugin/addon APIs whose behaviour changes between versions.
- Defence in depth on security, money, data-loss or concurrency paths.
- Handlers that translate an error into the project's error type, add context, or clean up.
- Guards against documented quirks of the runtime (a host API that returns nil during loading).
- Guards the type checker needs to narrow a type (an optional value checked before use). Delete
  it and run the type check: if the gate fails, the guard is load-bearing, whatever the runtime does.
- Existence guards a partial load needs: a test harness or optional module that loads a subset of
  files. "Always defined earlier in the load order" holds only for the full load; run the tests.

## Judgment

Where does this value come from, and can it actually be in the state this code defends against?
If the handler fires, does anything better happen than letting the error surface?

## Output

On the guard or handler. `what` names the contract that already guarantees the condition (with the
file:line that enforces it); for swallowed errors, `why` names the failure that would be
hidden.

## Safe move

Delete the check the types or invariants already make impossible, and keep the one at the boundary where untrusted data enters.
