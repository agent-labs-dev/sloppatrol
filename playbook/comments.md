# Comments

This repo bans comments (`comments.ban` in `sloppatrol.yml`). This page replaces every rule elsewhere in the playbook and the rubric that keeps a comment for saying why. The repo's own written rules still win where they are stricter or name other kinds.

## What may stay

- Tool directives: lint and type suppressions, pragmas, `@license` and SPDX headers, `@deprecated`, test-environment markers.
- A one-line `TODO` that names an issue or a condition.
- An external constraint, in exactly this form: `External: <the vendor, protocol or platform cause>. Retires when <the condition>.`
- A contract doc comment on an exported name, where every paragraph starts with a label: `Fails:`, `Needs:`, `Null:`, `Order:`, `Owner:`, `Units:`, `Effect:` or `Stable:`. No `@param` or `@returns` that restate the signature, and no issue or decision-record citation.
- Text a model reads: prompts, tool and schema descriptions. They are behaviour, not comments.

Every other comment is a defect, and so is a comment that says something the code does not do.

## The ladder

For each comment, take the first step that fits:

1. **It narrates or records history** ("loop over the rows", "changed in v2", "fixed the bug where"): delete it.
2. **A name can carry it**: rename the variable, function or constant, or extract a named function or constant, then delete the comment. `const retained = new Map() // ms until a failed key is retried` becomes `const failureRetainedUntilMs = new Map()`.
3. **A type or a test name can carry it**: a union, a distinct id type, a named constant for a bound. A test name is the tests side: raise it as a separate opportunity.
4. **It is a contract of an exported name**: rewrite it as a labelled doc comment.
5. **It is a constraint you do not control**: rewrite it as `External: … Retires when …`.
6. **Nothing in the code can carry it**: move it, in plain words, to the `## Gotchas` section of the owner's document (the feature's or package's README or doc). Keep it only when that document already exists or the repo names where such notes go; otherwise leave the comment and say why in the summary.

A comment that sits where a failure is dropped on purpose (`catch {}`, `.catch(() => {})`, `except: pass`) becomes the name of an empty function that the handler calls: `catch { logoutFailsWhenNoUserIsSignedIn(); }`.

## Drift

A comment that contradicts the code is worse than none: an agent trusts it and copies the mistake. The code is the truth, because the tests pin the code and not the comment.

- When the comment and the code disagree, never change the code to match the comment. That is a behaviour change: raise it as a finding.
- Delete the stale comment, or apply the ladder to what the code really does.
- The same holds for doc comments of an exported name, `README` sections and agent instructions that name a function, flag, path or default that no longer exists or now behaves differently. Fix the text in the same change as any rename that makes it stale.

## For each role

- **Surveyor**: comment work is in scope on every survey. Prefer one folder or one concept per opportunity (`simplify`), the folders agents copy from first, and comments that drift from the code before comments that only narrate. Count what the opportunity removes in its `problem`.
- **Refactorer**: a comment change never changes code, except a rename or an extraction from step 2. Keep a comment refactor comment-only where you can: in TypeScript and JavaScript the gate then proves it by comparing the parsed tokens, and plants no bug. A step-2 rename makes the code differ, so it goes through the usual planted-bug proof, and every reference to a renamed name moves in the same change. Never add a comment outside the kinds that may stay.
- **Reviewer**: reject a change that adds a comment outside those kinds, that drops a constraint without carrying it into a name, a type, a contract, an `External:` line or the owner's document, or that edits code to agree with a comment.
- **Assessor**: under `clarity`, count every comment outside those kinds as noise, "why" comments included, and count drift as a misleading name.
