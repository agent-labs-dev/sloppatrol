# Smells

Each smell is a heuristic, never a verdict. Most come from Fowler's *Refactoring* and Ousterhout's *A Philosophy of Software Design*.

The smells an audit can check are the lenses in [lenses](../skills/sloppatrol/references/lenses/): each says what the defect is, what not to flag, how to judge it and the safe move. The patrol and the audit use the same lenses, and the playbook lists them after this page. The smells below need the context of a whole change, so they guide the surveyor and are not audit findings. The format: what it is → the safe move.

- **Shotgun surgery**: one logical change needs edits in many files. → Gather what changes together into one module.
- **Message chain**: `a.b().c().d()` across modules. → Hide the walk behind one method on the first object.
- **Data clump**: the same few values always travel together. → Bundle them into one type.
- **Mysterious name**: a name that does not say what the thing is or does; `data`, `info`, `handle`, `manager`, `utils`, `helper`, `v2`. → Rename it; if no honest name comes, the design is murky.
- **Feature envy**: a function that uses another object's data more than its own. → Move it to the data.
- **Untested hot spot**: a file that changes often and has no test. → `characterize` first.
