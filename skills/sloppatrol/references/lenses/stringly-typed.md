# stringly-typed

## Defect

A closed set of values (statuses, kinds, modes, event names, categories) passed around as bare
strings or magic numbers (numeric codes for a closed set count too) and compared by literal at read
sites, instead of an enum, a union/literal type, or named constants defined once. Typos compile, the
set cannot be enumerated, and branching on it cannot be checked for exhaustiveness.

## Do not flag

- Open sets (user-provided names, identifiers from an external system).
- Wire formats at the boundary where the literal *is* the contract, as long as it is converted to
  the typed form once, at that boundary. Persisted keys (saved data, database values, config keys)
  are wire formats too.
- Languages or runtimes without enums where the project already uses a consistent constants table:
  flag only literals that bypass that table.

## Judgment

Is this set of values closed and known to the program? If a new member were added, would every
place that branches on it be found by the compiler, a linter or a single search?

## Output

On a representative comparison or definition. `what` lists the literal values and where they are
compared; `why` names the missing exhaustiveness or the typo it permits.

## Safe move

Give the concept its own type: a union for states and modes, distinct types for ids and units, one module that owns the closed set and its branches.
