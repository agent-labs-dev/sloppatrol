# oversized-modules

## Defect

Files and functions that have grown past the point where one person can hold them in their head:
god files mixing unrelated responsibilities, functions with deep nesting and many branches, modules
every change has to touch. They are where duplication and dead code accumulate unseen.

## Do not flag

- Size alone. A long file with one coherent responsibility (a data table, a generated file, a flat
  list of simple handlers) is fine.
- Size the language or framework forces (a single-file plugin format, a manifest).

## Judgment

Can you name the separate responsibilities in this file? Would a change to one of them ever need
to touch the others? If they separate cleanly, where would each part live?

## Output

On the file's first line (or the function's definition). `what` lists the distinct responsibilities
with line ranges; `why` proposes the split. Audits never perform a split: a split moves
code and belongs in its own reviewed change. Removing dead code from the file first often makes the
split unnecessary.

## Safe move

Split along the concepts the file owns, one cohesive group at a time; the original thins to composition. Extract named steps from a long function, with guard clauses for early exits.
