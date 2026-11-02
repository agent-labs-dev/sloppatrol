# comment-narration

## Defect

Comments that cost more than they return:

- narration that restates the next line ("increment the counter", "loop over the items");
- walls of prose explaining what well-named code already says;
- history that belongs in version control ("changed in v2", "used to do X", "added for ticket 123",
  "fixed the bug where...");
- stale comments that describe behaviour the code no longer has;
- commented-out code;
- decorative banners and section separators in short files;
- docstrings that only repeat the signature.

## Do not flag

- Comments that explain **why**: a constraint, a workaround with its cause, a non-obvious invariant,
  a performance or security reason, a link to the spec or upstream bug.
- Public API documentation the project's tooling or users consume.
- License headers, pragmas, type or lint annotations, directives, and `sloppatrol:` markers.
- **Text a model reads.** Prompts, tool and parameter descriptions, schema docstrings and enum values
  a model sees are behaviour, not comments: a model acts on every word. A docstring that is also a
  tool or schema description belongs here. If one looks wrong, report it for the owner to decide
  (the audit routes it as `decide`), never as narration to cut.
- The project's established documentation convention, even if verbose: judge drift from it, not
  against a generic ideal.

## Judgment

If this comment were deleted, would a competent reader of this codebase lose anything the code does
not already tell them? If the comment is wrong, what does the code actually do?

## Output

On the comment's first line. `what` says which kind (narration, history, stale, commented-out);
for stale comments, `why` states what the code actually does. Suggest the shorter
replacement when a comment should shrink rather than go.

## Safe move

Rename or restructure until the comment is not needed, or delete it. Keep comments that say why.
