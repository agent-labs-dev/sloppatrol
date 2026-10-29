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

2. Make `checks` the commands that prove behaviour in your repo: typecheck, lint, tests, build. Mark the test commands with `tests: true`. Put the install command in `prepare`. [Configuration](configuration.md) shows each setting.

3. Check the setup. `doctor` shows the agent of each role, the rule files it found, and what is missing. `check` runs your checks on `main`, and they must pass:

   ```bash
   npx sloppatrol doctor
   npx sloppatrol check
   ```

4. Start the patrol, and open the dashboard on http://127.0.0.1:4322:

   ```bash
   npx sloppatrol           # a cycle every hour, with the dashboard
   npx sloppatrol --once    # one cycle, then stop
   ```

5. Read the verified refactors in the dashboard. Then open their pull requests:

   ```bash
   npx sloppatrol publish
   ```

   To let the patrol open draft pull requests by itself, set `github: { enabled: true }`.

The stronger your tests, the more Sloppatrol can do. Where code has no tests, it proposes characterization tests first. [How it works](how-it-works.md) tells why.
