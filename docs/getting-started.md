# Getting started

You need Node 22 or later, `git`, and an agent CLI: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex) or [opencode](https://opencode.ai). To open pull requests, you also need a logged-in [`gh`](https://cli.github.com) CLI.

1. Run `init` in your repo. It writes `.sloppatrol/sloppatrol.yml` with a guess at your checks:

   ```bash
   npx sloppatrol init
   ```

   ```text
   .sloppatrol/
     sloppatrol.yml     # the config: commit it
     instructions.md    # your notes for the agents: commit it
     runs/              # opportunities, refactors, check runs, scores, sessions: git ignores it
   ```

2. Make `checks` the commands that prove behaviour in your repo: typecheck, lint, tests, build. Mark the test commands with `tests: true`. Put the install command in `prepare`. Checks run in a fresh checkout that holds no file git ignores, so `prepare` also carries in any cache they read: [Configuration](configuration.md#where-the-checks-run) shows each setting.

3. Check the setup. `doctor` shows the agent of each role, the rule files it found, and what is missing. `check` runs your checks on `patrol.pull`, and they must pass. Add `--ref HEAD` to check your branch before it merges:

   ```bash
   npx sloppatrol doctor
   npx sloppatrol check
   npx sloppatrol check --ref HEAD
   ```

4. Start the patrol. Add `--dashboard` to follow it on http://127.0.0.1:4322:

   ```bash
   npx sloppatrol               # a cycle every hour at most, slower while nothing is found
   npx sloppatrol --dashboard   # the same, with the dashboard
   npx sloppatrol --once        # one cycle, then exit
   ```

5. Read the verified refactors with `npx sloppatrol status` or in the dashboard. Then open their pull requests:

   ```bash
   npx sloppatrol publish
   ```

   To let the patrol open pull requests by itself, set `github: { enabled: true }`.

The stronger your tests, the more Sloppatrol can do. Where code has no tests, it proposes characterization tests first. [How it works](how-it-works.md) tells why.
