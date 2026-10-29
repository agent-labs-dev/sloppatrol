export const USAGE = `sloppatrol: a team of agents that makes your code cleaner, one verified refactor at a time.

Start
  sloppatrol init              Create .sloppatrol/ with a guess at your checks
  sloppatrol doctor            Show the config, the agent each role runs on, and what is missing

Run
  sloppatrol                   Patrol all day: a cycle every patrol.intervalMinutes, with the dashboard
  sloppatrol --once            One cycle, then stop
  sloppatrol dashboard         Only the dashboard (http://127.0.0.1:4322)

One step at a time
  sloppatrol check             Run your checks on the patrolled commit (the oracle)
  sloppatrol survey            Let the surveyor record opportunities now
  sloppatrol refactor [id]     Attempt one opportunity now: the best open one, or <id>
  sloppatrol score             Score the repo now: up to metrics.panel more files (--files <n>)
  sloppatrol publish           Open pull requests for verified refactors (--dry-run)

Read
  sloppatrol status            The opportunities, the refactors and the agents
  sloppatrol census            What the surveyor sees: stack, large files, mocks, churn
  sloppatrol dismiss <id>      Never propose this opportunity again (--reason "...")

Flags
  --agent <name>    init: auto (default), claude, codex or opencode
  --port <n>        The dashboard port (default 4322)
  --files <n>       score: how many more files to score in this run
  --no-dashboard    Patrol without the dashboard
  --cwd <dir>       Run as if in <dir>
  -h, --help        This help
  -v, --version     The version`;
