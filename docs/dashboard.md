# The dashboard


`sloppatrol` serves a dashboard on `http://127.0.0.1:4322` while it patrols (`--no-dashboard` turns it off; `sloppatrol dashboard` serves it alone). It shows, live:

- **Agents**: what the patrol, the surveyor, the refactorer, the gate and the reviewer do now.
- **Refactors**: each attempt as a pipeline (refactorer → guards → checks → mutation → metrics → review → pull request), with its full proof.
- **Scorecard**: each metric's score and trend over commits, and every file of the panel with the evidence behind its scores.
- **Checks**: every check run on `main`, on each refactor, and each run the refactorer starts itself, with the output of each check.
- **Backlog**: the opportunities by status, with the problem, the change and the files.
- **Sessions**: every agent session as a timeline of its tool calls.

![The Scorecard tab of the dashboard on a demo project](../assets/dashboard.png)
