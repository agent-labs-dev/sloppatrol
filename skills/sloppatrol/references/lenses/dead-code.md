# dead-code

## Defect

Code, files, dependencies, config keys, flags, environment variables, CI jobs or docs that nothing
reaches in any supported way. Includes whole **dead islands** (symbols that only reference each
other) and **test-only** production code, kept alive solely by a test of itself.

## Do not flag

**Hard stops.** Never report these as dead, whatever the searches say:

- **String-built names.** If any code assembles a name from strings (concatenation, formatting, a
  key into a table or registry, reflection), every symbol that could match the pattern is presumed
  live.
- **Decorated or registered symbols.** A symbol with a decorator, annotation or attribute, or one
  passed to a registration call, is presumed live: the framework is the caller. It is dead only if
  you found the registry and showed nothing reads that entry.
- **Load-bearing by definition**, even with no reference in the code:
  - persisted enum values and serialised names (rows, files, messages and caches already written);
  - durable workflow and step names (a queued or interrupted run looks them up by name to resume);
  - database migrations (an environment that has not yet run them still will);
  - recovery and repair tools (run by hand, during an incident).
- **Non-source callers.** Scripts, CI, hooks, build files, container files, cron entries and docs
  that tell a person to run something. A unit reached only this way is live.
- **Cross-repository consumers.** Other repositories, users of a published package, deployed
  clients and plugins are live roots. Anything public is live unless you can list every consumer.

Absence of a reference is not proof of death. Before reporting anything else, rule out each path
below with a search of a *different kind* than re-grepping the name:

1. **Dynamic dispatch**: names built from strings, reflection, `getattr`/`_G[...]`/`obj[key]`,
   registries, event names, decorators whose framework is the caller, dependency injection.
2. **Public surface**: exported package API, CLI commands, HTTP routes, library entrypoints,
   anything another repository or a user may call.
3. **Manifests and ops**: files listed by a manifest or build file, scripts run by CI, cron, hooks,
   Makefiles, Dockerfiles, docs that tell a human to run something.
4. **Data-driven lookup**: names in config, YAML, JSON, XML, SQL, templates, localisation tables,
   saved or persisted data.
5. **Cross-boundary**: other runtimes, other packages in a monorepo, generated code, plugins,
   out-of-tree consumers.
6. **Open work**: unmerged branches and open pull requests. A symbol dead on the default branch
   but referenced by work about to merge is live: `git grep -n <name> <branch>` for each branch the
   audit listed as in flight.

Also leave alone code that only *looks* dead: idempotency guards, defence-in-depth checks, feature
flags and kill switches, compatibility for data or clients already in the wild, cleanup and
cancellation paths, metrics consumed by off-repo dashboards. If in doubt, it is not proven.

Also not dead: seams that exist so tests can stub the host (injectable timers, optional
dependencies a spec leaves out). They are live through the tests; judge them with `test-plumbing`.

## Judgment

Could any supported way of running, deploying or consuming this project reach this code, and have
you searched for that way, not just for the name?

Deletion runs to a fixpoint. Each deletion can make more code dead (a new dead island) and can
change what an earlier verdict rested on. After each deletion, rerun the evidence and re-verify the
remaining candidates against the tree as it is now. Each new candidate is a new ledger item and goes
through verification like any other; stop when a rerun adds none.

## Output

One finding per dead unit, on its definition line. `what` names the unit and its **fate**:

- `fully dead`: no reachable reference anywhere; delete it.
- `test-only`: only its own tests reach it; delete it **and** those tests.

A unit reached only from outside the scanned roots (a script, CI, a manifest) is live, not a
finding: record its caller in the project skill as a live root instead.

`why` names the hard stops that do not apply, and lists which of the six paths you
checked and how.
Rank by the size of the containing file: removals from the largest files pay most.

## Safe move

Delete the unit and the tests that only exercised it, once every reachability path is ruled out. Never delete a test case of live code.
