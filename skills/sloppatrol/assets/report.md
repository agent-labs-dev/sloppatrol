# sloppatrol audit: <PROJECT> @ <short-sha>

Scope: <whole repo | path | diff vs base>.
Gate before: <pass | fail | known red: ledger ids>. Gate after: <pass/fail>.
Open work: <n branches, n PRs; hot files left unedited>. Previous report: <commit | none>.

## Carried forward

Every `open`, `confirmed` or `unproven` ledger item from before this run, and where it ended.

| Id | Location: candidate | Disposition |
|---|---|---|
| `<id>` | `<file>:<line>`: <what> | <fixed / confirmed, hot / dismissed: reason / unproven: what would settle it / decide> |

## Slices

Reviewer and Verifier say how separate each was from the agent running the audit: `other model`,
`independent` (a fresh sub-agent of the same model) or `same agent`.

| Slice | Files read | Reviewer | Verifier | Candidates | Confirmed | Dismissed | Unproven | Decide | Changed | Gate |
|---|---|---|---|---|---|---|---|---|---|---|
| `<path>` | n/n | independent | other model | n | n | n | n | n | n | pass |

Not reviewed: <slices whose reviewer failed twice, or "none">. Unverified: <items whose verifier
failed, or "none">.

## Confirmed

Every item confirmed or fixed this run. The Guard column is copied from the ledger
(`ledger.py list --json`, field `guard`), never written by hand.

| Id | Location | Lens | Outcome | Guard | Lines |
|---|---|---|---|---|---|
| `<id>` | `<file>:<line>` | <dead-code, parallel-implementations, ...> | <fixed / confirmed, hot> | <rule:<id> / settled:<name> / lens-only: <why>> | -n |

Net: -<n> lines across <n> files. Guards: <n> rule, <n> tool rule, <n> settled, <n> lens-only.

## Needs a decision

Items the audit may not settle itself (text a model reads, user-facing copy, design changes, work
in another repository), each with the owner's question from the ledger reason.

| Id | Location | Question |
|---|---|---|

## Bugs found, not fixed

| Id | Location | Evidence | Suggested fix |
|---|---|---|---|

## Gate loosening

Everything since the previous report that makes the gate easier to pass: markers, `ignores:`
entries, deleted rules or tests, detector config, and `.sloppatrol/gate.py` diffs. Excludes need the
user's approval. Write "none" when there are none.

| Change | Path | What it loosens | Approved by |
|---|---|---|---|

## Gate grown

- Rules added: <id: what it prevents, hits when written>
- Settled: <shape: reason>
- Anti-patterns: <shape, lens, path>
- Lenses and project skill updates: <what changed>

## Next

<the single most valuable follow-up>
