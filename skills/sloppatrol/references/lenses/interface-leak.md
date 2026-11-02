# interface-leak

## Defect

Code that knows another module's internals: an import of a file behind the module's entry point,
or two modules that each encode the same format, rule or protocol, so a change to it has to touch
both. The module's interface no longer says what callers depend on.

## Do not flag

- Tests of a module importing its own internal files, where the repo's rules allow it.
- A shared format with one owner that both sides import from.
- Generated clients and their generator, or a published contract both sides pin.
- An import the repo's module-boundary tool already allows by an explicit rule.

## Judgment

If the internal file or the shared knowledge changed, which other modules would break without a
compiler or check noticing? Name each one and what it knows. A deep import that the module's
entry point could export, or a format that one module could own, is a finding.

## Output

On the import line, or on the second copy of the shared knowledge. `what` names the module whose
internals leak and the knowledge that is shared; `why` names the owner it should have.

## Safe move

Import from the module's entry point, and export the name there if it belongs in the interface.
Give shared knowledge one owner; the other module asks it.
