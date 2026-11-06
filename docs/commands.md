# Commands


```text
Start
  sloppatrol init              Create .sloppatrol/ with a guess at your checks
  sloppatrol doctor            Show the config, the agent each role runs on, and what is missing

Run
  sloppatrol                   Patrol all day: a cycle every patrol.intervalMinutes, with the dashboard
  sloppatrol --once            One cycle, then stop
  sloppatrol dashboard         Only the dashboard (http://127.0.0.1:4322)
  sloppatrol score             Score every file, then open the scorecard, ready to share
  sloppatrol review <pr|ref>   Score the files a pull request or branch changes, against its merge base

One step at a time
  sloppatrol check             Run your checks on the patrolled commit (the oracle)
  sloppatrol survey            Let the surveyor record opportunities now
  sloppatrol refactor [id]     Attempt one opportunity now: the best open one, or <id>
  sloppatrol publish           Open pull requests for verified refactors (--dry-run)

Read
  sloppatrol status            The opportunities, the refactors and the agents
  sloppatrol census            What the surveyor sees: stack, large files, mocks, churn
  sloppatrol dismiss <id>      Never propose this opportunity again (--reason "...")
```

`sloppatrol score` scores each file that has no score yet, then serves the dashboard and opens its share page: a card to post, with a button that saves it as a PNG. It does not run your checks, because a score verifies nothing, so it works also while main is red. `--files <n>` scores at most `n` more files, `--no-open` does not open the browser, and `--no-dashboard` only prints the scorecard.

`sloppatrol review <pr|ref>` scores only the files that a pull request or a branch changes. A number, `#42` or a GitHub pull request URL names a pull request; `gh` gives its head and its base branch. Any other argument is a git ref, and it compares with `patrol.pull`. `--base <ref>` sets another base. Sloppatrol scores each changed file at the head and at the merge base, in checkouts under `.sloppatrol/runs/reviews/`, and removes them after. It uses the same score cache as `sloppatrol score`. The command prints a table, worst change first, and the line-weighted total. It changes no code, runs no checks, and posts nothing. It exits 1 when a file loses 10 points or more.

Add `--cwd <dir>` to run a command in another repo. `sloppatrol --help` shows the usage.

Omitting the command starts the patrol. An unknown command exits 2 with a help hint before loading the repo, starting the dashboard, or running agents.
