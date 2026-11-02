# wall-of-text

## Defect

The reader cannot find the information needed for the page's purpose. Candidates include a buried
outcome or command, unrelated rationale interrupting a procedure, options that are hard to compare,
redundant framing, and detail loaded before it is needed. Size alone does not prove a defect.

Applies to READMEs, contributor and agent docs, skill files, docstrings, CLI help, user-facing
messages and PR or changelog text the project keeps.

## Do not flag

- Depth needed for an explanation, ADR, reference, legal text or licence.
- Useful repetition at independent entry points, including warnings and prerequisites.
- Real uncertainty, exact terminology and version history needed for migration.
- A long table of real options or a paragraph whose argument requires connected prose.
- A sentence or page solely for crossing a word-count threshold.
- Anything a configured prose linter already reports.
- Text a model reads, including prompts and shipped skills, as ordinary prose to tighten.
  Report the concern as `decide`; its eval must validate any change. The repository's own agent
  docs remain in scope for factual corrections under the audit's rules.

## Judgment

Name the intended reader and what they came to find. Can headings, first lines and examples lead
them there without losing prerequisites or qualifications? For human docs, follow
[the docs workflow](../docs.md). Reader needs inform structure, not a mandatory page template.
Name the precise obstruction and a cut, reordering or linked disclosure that preserves meaning.

## Output

On the passage's first line. `what` names the information made hard to find; `why` gives the
reader consequence and concrete change. Follow the audit's closed set. User-facing strings,
published copy and model-read text are `decide` unless their edit is authorised.

## Safe move

Cut repetition and padding, turn prose into a list, table or code block, move depth behind a link, dropping no fact.
