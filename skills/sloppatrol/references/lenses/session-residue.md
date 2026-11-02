# session-residue

## Defect

Leftovers from the session that wrote the code: debug prints and logging at the wrong level,
`TODO`/`FIXME`/`XXX` with no owner or plan, commented-out experiments, temporary files and scripts,
hard-coded test values, disabled tests without a reason, placeholder names (`foo`, `tmp2`,
`new_function`), and "for now" branches that became permanent.

## Do not flag

- TODOs that reference a tracked issue or state a concrete condition.
- Logging that is part of the program's observable behaviour or diagnostics.
- Scripts that are documented and used.
- Debug features a user can turn on (a debug command, a saved trace): they are product.

## Judgment

Did someone intend this to still be here? If it were removed, would anyone notice?

## Output

On the residue. `what` names it; `why` says what removing it changes (usually nothing)
or, for a TODO worth keeping, what issue it should reference.

## Safe move

Delete the leftover: debug output, scratch files, commented-out code, notes about the session.
