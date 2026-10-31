# The dashboard

`sloppatrol` serves a dashboard on `http://127.0.0.1:4322` while it patrols (`--no-dashboard` turns it off; `sloppatrol dashboard` serves it alone). It reads the files under `.sloppatrol/runs/` and updates live, so it works during a patrol and after it. It listens on 127.0.0.1 only, and it is read-only.

![The Overview of the dashboard on a demo project](../assets/dashboard.png)

## Pages

Each page starts with its numbers. Filters follow, then the details, with the problems first. Click a row to see its details and its evidence in a side panel.

| Page | What it shows |
| --- | --- |
| Overview | The status of the project: the checks on main, what waits for you, the backlog, the code quality and its change, and the last cycle with its result. Then the items that need attention, each with the command to run next, the agents, the quality of each metric, the refactor results, and the recent refactors |
| Refactors | Each attempt as a pipeline (refactorer → guards → checks → mutation → metrics → review → pull request), with its full proof. The groups are: in progress, waits for you, stopped with an error, rejected by the gate (with the step that rejected it), merged, and closed |
| Scorecard | The overall score, each metric with its change and its trend, the repo guardrails, and each scored file, lowest first, with the evidence behind its scores |
| Checks | Each check run on main, on each refactor, and each run the refactorer starts itself, with the output of each check. A problem is a red run on main, a refactor that the gate failed, or a planted bug that the tests missed |
| Backlog | The opportunities by status. The open ones show in the order the refactorer picks them, and the ones that wait for a refactor that changes the same files |
| Sessions | Each agent session as a timeline of its tool calls, with its cost |

The **share page** (`#share`) shows the scorecard as one card, 1200 by 675 pixels, for a post: the overall score, each metric, the guardrails, and how much of the repo the scores cover. It has no top bar, so a screenshot shows only the card. **Download PNG** saves the card at twice its size, and **Copy image** copies it. `sloppatrol score` opens this page, and the Scorecard page links to it.

A page with no data says what it shows, why it is empty now, and the command to run next.

The theme follows the system setting. The theme button in the top bar (a monitor, sun, or moon icon) changes it to Light, then Dark, then back to System. The browser keeps your choice.

## The numbers

The server computes each number once, and each page shows the same numbers. `GET /api/summary` returns them as JSON:

- **Status**: `Blocked` when the checks fail on main, because no refactor can be verified then. `Needs a look` when work stopped with an error. `Waits for you` when a refactor waits to be published or a pull request waits for review. `Healthy` when none of these is true.
- **Running work**: a refactor, a check run, or a session that the files mark as running shows as stopped when no Sloppatrol process runs. The next patrol cleans up the work and ends the open sessions.
- **Quality change**: the change compares the last two scorecards over the files that both scored, so a file that joins the panel does not read as a change in quality.
- **Last cycle**: each patrol cycle saves its result in `.sloppatrol/runs/cycles/`.

## Demo data

The tests make four demo projects: one with no run, one after its first cycle, one busy project, and one whose checks fail on main. To look at the dashboard on them:

```bash
pnpm tsc -p tsconfig.json --outDir node_modules/.cache/demo
node node_modules/.cache/demo/dashboard/tests/write-fixtures.js /tmp/sloppatrol-fixtures
node dist/cli/index.js dashboard --cwd /tmp/sloppatrol-fixtures/busy
```
