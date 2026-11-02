# copy-slop

## Defect

Empty or misleading wording obscures what the reader can do, decide or understand. Applies to
docs, READMEs, UI and CLI copy, docstrings, and retained PR or commit text. Review usefulness and
supported meaning, not presumed authorship.

Candidates include generic praise in place of a capability, a guarantee without support, vague
attribution, a contrast that adds no distinction, redundant introductions or summaries, and leaked
chat/citation markup that readers cannot use. A stock phrase is a search cue, not a verdict.

## Do not flag

- Punctuation, Unicode, sentence length, rhythm, a three-item list or a detector score on its own.
- Consistent technical vocabulary, parallel steps, exact UI names and literal identifiers.
- Useful repeated warnings and prerequisites at independent entry points.
- Real uncertainty, necessary contrasts and version history that changes the reader's path.
- Quotations, third-party or vendored text, legal text and licences.
- A project's explicitly adopted style. A violation needs that rule, not an authorship assertion.
- Marketing written for that purpose: route concerns to its owner and brief.
- Model-read text as ordinary prose to tighten: route it as `decide` and use its eval.
- Narrating comments or navigation problems better covered by `comment-narration` or `wall-of-text`.

## Judgment

What information or reader action is lost, obscured or falsely promised? Quote the passage and
prove that consequence, or cite the explicit local style rule it violates. Counts of words,
categories or equal-length sentences cannot supply that evidence. Do not infer AI authorship.

Try to refute the finding using the audience and genre. Does a repetition restore needed context?
Does a qualification express real uncertainty? Does a contrast explain a choice? Keep those facts.
For human docs, use [the evidence workflow](../docs.md) before rewriting. Replacing a stock word
with a synonym does not repair an empty claim; inventing a capability makes it worse.

## Output

On the passage's first line, quoting the exact words. `what` names the concrete defect;
`why` gives its reader consequence or local rule and a supported correction. Unsupported product
facts belong to `stale-docs`; report a defect only once. New or published copy and user-facing
strings follow the audit's `decide` route unless editing is authorised.

## Safe move

Say the concrete thing in plain words, dropping no fact, command or link. Copy users or models read is behaviour: it follows the audit's `decide` route.
