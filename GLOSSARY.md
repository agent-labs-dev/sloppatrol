# Glossary

- **Opportunity**: one improvement the surveyor found: a kind, the files it changes, the problem, the change, the benefits, a strength. One per fingerprint (kind and files), ever.
- **Kind**: what a refactor does, e.g. `split-module`, `inject-dependency`, `replace-mock`. The kind decides the side.
- **Side**: `source` or `tests`. A refactor changes one side only (ADR 0002).
- **Refactor**: one attempt at one opportunity, in its own worktree and branch.
- **Gate**: the code that decides whether a refactor is kept: the guards, then the checks (ADR 0001).
- **Guard**: a rule on the diff: one side, frozen files, no suppression, tests kept, size.
- **Check**: one of the repo's own commands (typecheck, lint, test, build). The checks are the oracle.
- **Check run**: one run of the checks: on the patrolled commit (`base`), on a refactor (`gate`), or by the refactorer on its own change.
- **Review**: the reviewer's verdict on a refactor that passed the gate. It can only reject.
- **Census**: facts about the repo that code measures: the stack, the largest files, mock use in tests, churn.
- **Playbook**: the engineering rules every role follows, with one page per stack.
- **Patrol**: the loop that runs a cycle on the patrolled ref every `intervalMinutes`.
- **Metric**: one of seven qualities (simplicity, modularity, injection, purity, tests, clarity, guardrails), named so that more is better, scored per file as one of five rubric levels and shown as 0–100.
- **Assessor**: the agent that scores files against the rubric, with the lines as evidence.
- **Scorecard**: the scores of a fixed panel of files on one commit, and the mean per metric.
- **Proof**: a refactor's evidence: that it broke nothing, that its metrics went up, and that it followed the repo's rules.
- **Mutation**: a bug a tests refactor plants in the unchanged source; a test check must catch it.
