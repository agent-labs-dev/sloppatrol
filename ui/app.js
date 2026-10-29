// The Sloppatrol dashboard: reads /api/state every two seconds and renders
// the agents, the refactors with their gate, the check runs, the backlog and
// the agent sessions. Read-only.

const LANES = [
  ['patrol', 'Patrol'],
  ['surveyor', 'Surveyor'],
  ['refactorer', 'Refactorer'],
  ['assessor', 'Assessor'],
  ['gate', 'Gate'],
  ['reviewer', 'Reviewer'],
];
const OPPORTUNITY_FILTERS = ['open', 'verified', 'proposed', 'done', 'exhausted', 'dismissed', 'all'];

let state;
let selection; // { type: 'refactor' | 'check' | 'opportunity' | 'session', id }
let backlogFilter = 'open';
const fetched = new Map(); // full check runs and session events, by key

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.parse(state?.now ?? Date.now()) - Date.parse(iso)) / 1000);
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function seconds(ms) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/** A status word to a chip tone. */
function tone(status) {
  if (['passed', 'verified', 'published', 'merged', 'done', 'proposed', 'approved'].includes(status)) return 'ok';
  if (['failed', 'rejected', 'exhausted', 'blocked'].includes(status)) return 'bad';
  if (['running', 'working', 'open'].includes(status)) return status === 'open' ? '' : 'run';
  return '';
}

function chip(text, cls = tone(text)) {
  return `<span class="chip ${cls}"><span class="dot"></span>${esc(text)}</span>`;
}

function setHtml(element, html) {
  if (element.dataset.html !== html) {
    element.innerHTML = html;
    element.dataset.html = html;
  }
}

// ---------- header, lanes, totals ----------

function renderTop() {
  $('project').textContent = state.project;
  const p = state.patrol;
  setHtml(
    $('meta'),
    [
      p.lastSha ? `<span>main <code>${esc(p.lastSha.slice(0, 10))}</code></span>` : '',
      `<span>${p.cycles} cycle${p.cycles === 1 ? '' : 's'}</span>`,
      p.lastCycleAt ? `<span>last cycle ${ago(p.lastCycleAt)}</span>` : '<span>no cycle yet</span>',
    ].join(''),
  );
  const statuses = Object.fromEntries(state.statuses.map((s) => [s.role, s]));
  setHtml(
    $('lanes'),
    LANES.map(([role, label]) => {
      const s = statuses[role];
      const status = s ? s.state : 'idle';
      return `<div class="lane" ${s?.sessionId ? `data-session="${esc(s.sessionId)}"` : ''}>
        <div class="lane-head">${esc(label)} ${chip(status, status === 'idle' ? '' : tone(status === 'done' ? 'passed' : status))}</div>
        <div class="lane-detail">${esc(s?.detail ?? 'Not started.')}</div>
        <div class="lane-time">${s ? ago(s.updatedAt) : ''}</div>
      </div>`;
    }).join(''),
  );
  const count = (list, ...statuses) => list.filter((x) => statuses.includes(x.status)).length;
  // Only refactors the gate judged: an attempt that failed or stopped was never judged.
  const gate = state.refactors.filter((r) => !['working', 'failed'].includes(r.status));
  const kept = count(gate, 'verified', 'published', 'merged', 'closed');
  setHtml(
    $('stats'),
    [
      [state.opportunities.filter((o) => backlogStatus(o) === 'open').length, 'open opportunities'],
      [count(state.refactors, 'verified'), 'verified, to publish'],
      [count(state.refactors, 'published'), 'pull requests open'],
      [count(state.refactors, 'merged'), 'merged'],
      [count(state.refactors, 'rejected'), 'rejected by the gate'],
      [gate.length ? `${Math.round((kept / gate.length) * 100)}%` : '–', 'of refactors kept'],
    ]
      .map(([n, label]) => `<span><b>${n}</b>${label}</span>`)
      .join(''),
  );
}

// ---------- refactors ----------

function opportunityOf(refactor) {
  return state.opportunities.find((o) => o.id === refactor.opportunityId);
}

function gateRun(refactor) {
  return state.checkRuns.find((run) => run.refactorId === refactor.id && run.purpose === 'gate');
}

/** The five steps of a refactor, each `ok`, `bad`, `run`, or pending. */
function steps(refactor) {
  const v = refactor.verdict;
  const run = gateRun(refactor);
  const working = refactor.status === 'working';
  const agent = refactor.headSha ? 'ok' : working ? 'run' : 'bad';
  const guards = v ? (v.guards.length ? 'bad' : 'ok') : '';
  const checks = run ? { running: 'run', passed: 'ok', failed: 'bad' }[run.status] : '';
  const proof = refactor.proof;
  const tests = opportunityOf(refactor)?.side === 'tests';
  const mutationRun = state.checkRuns.find((r) => r.refactorId === refactor.id && r.purpose === 'mutation');
  const mutation = proof?.behaviour?.mutation
    ? proof.behaviour.mutation.caught
      ? 'ok'
      : 'bad'
    : mutationRun?.status === 'running'
      ? 'run'
      : '';
  const metricsDone = proof?.improvement ? (proof.improvement.improved ? 'ok' : 'bad') : '';
  const ready = checks === 'ok' && (!tests || mutation === 'ok');
  const metrics = metricsDone || (working && ready ? 'run' : '');
  const review = v?.review ? (v.review.approve ? 'ok' : 'bad') : working && metrics === 'ok' ? 'run' : '';
  const pr = refactor.prUrl ? (refactor.status === 'closed' ? 'bad' : 'ok') : '';
  const checkLabel = run?.status === 'running' && run.current ? `Checks: ${run.current}` : 'Checks';
  return [
    ['Refactorer', agent],
    ['Guards', guards],
    [checkLabel, checks],
    ...(tests ? [['Mutation', mutation]] : []),
    ['Metrics', metrics],
    ['Review', review],
    [refactor.status === 'merged' ? 'Merged' : 'Pull request', pr],
  ];
}

function stepper(refactor) {
  const marks = { ok: '✓', bad: '✗', run: '•', '': '' };
  return `<div class="steps">${steps(refactor)
    .map(([label, s]) => `<span class="step ${s}"><span class="mark">${marks[s]}</span>${esc(label)}</span>`)
    .join('<span class="arrow">→</span>')}</div>`;
}

function renderRefactors() {
  if (!state.refactors.length)
    return empty('No refactor yet. The refactorer starts once the surveyor has recorded opportunities.');
  return `<div class="list">${state.refactors
    .map((r) => {
      const o = opportunityOf(r);
      const stat = r.diffStat
        ? `+${r.diffStat.added} −${r.diffStat.removed} in ${r.diffStat.files} file${r.diffStat.files === 1 ? '' : 's'}`
        : '';
      return `<div class="row ${selected('refactor', r.id)}" data-select="refactor:${esc(r.id)}">
        <div class="row-head">${chip(r.status)}<span class="row-title">${esc(o?.title ?? r.branch)}</span>${o ? `<span class="chip kind">${esc(o.kind)}</span>` : ''}</div>
        ${stepper(r)}
        <div class="row-sub"><span>${ago(r.updatedAt)}</span>${stat ? `<span>${stat}</span>` : ''}${r.reason && r.status !== 'verified' ? `<span>${esc(r.reason.split('\n')[0].slice(0, 140))}</span>` : ''}</div>
      </div>`;
    })
    .join('')}</div>`;
}

function refactorDetail(r) {
  const o = opportunityOf(r);
  const v = r.verdict;
  const run = gateRun(r);
  const sessions = state.sessions.filter((s) => s.subject === `refactor:${r.id}`);
  return `
    <h2>${esc(o?.title ?? r.branch)}</h2>
    <div class="pills">${chip(r.status)}${o ? `<span class="chip kind">${esc(o.kind)}</span><span class="chip kind">${esc(o.side)} only</span>` : ''}</div>
    ${stepper(r)}
    ${r.prUrl ? `<h3>Pull request</h3><p><a href="${esc(r.prUrl)}" target="_blank" rel="noreferrer">${esc(r.prUrl)}</a></p>` : ''}
    ${r.reason ? `<h3>Reason</h3><p>${esc(r.reason)}</p>` : ''}
    ${r.summary ? `<h3>What changed</h3><p>${esc(r.summary)}</p>` : ''}
    ${o ? `<h3>Files</h3><div class="files">${o.files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>` : ''}
    ${v?.guards?.length ? `<h3>Guard findings</h3>${v.guards.map((g) => `<p>✗ <b>${esc(g.guard)}</b> ${g.file ? `<code>${esc(g.file)}</code> ` : ''}${esc(g.detail)}</p>`).join('')}` : ''}
    ${run ? `<h3>Gate checks</h3>${checkPills(run)}<p><a href="#checks" data-select="check:${esc(run.id)}">Open the check run</a></p>` : ''}
    ${r.proof ? proofHtml(r.proof) : ''}
    ${v?.review ? `<h3>Review: ${v.review.approve ? 'approved' : 'rejected'}</h3><p>${esc(v.review.reasons)}</p>` : ''}
    <h3>Branch</h3><p><code>${esc(r.branch)}</code> from <code>${esc(r.baseSha.slice(0, 10))}</code></p>
    ${sessions.length ? `<h3>Agent sessions</h3>${sessionRows(sessions)}` : ''}`;
}

// ---------- proof ----------

/**
 * A score for people, 0-100. The assessor picks an anchored level 0-4 (which
 * keeps judges consistent); a level of 3 shows as 75.
 */
function pct(score) {
  return Math.round((score / 4) * 100);
}

/** The colour band of a 0-100 score. */
function band(score) {
  const p = pct(score);
  return p < 40 ? 'low' : p < 70 ? 'mid' : 'high';
}

function delta(before, after) {
  if (before === undefined || after === undefined) return '';
  const d = pct(after) - pct(before);
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
  return `<span class="delta ${cls}">${d > 0 ? '+' : ''}${d}</span>`;
}

function fmt(n) {
  return n === undefined ? '–' : String(pct(n));
}

function proofHtml(proof) {
  const b = proof.behaviour;
  // Each item is HTML: its text is escaped here, where it is built.
  const items = [
    b.side === 'source'
      ? 'Source only: the unchanged tests are the oracle.'
      : 'Tests only: the unchanged source proves the tests.',
    `Guards passed: ${b.guards.join(', ')}.`,
    b.testsHead !== undefined
      ? `The same checks pass on main and on the change: ${b.testsBase ?? '?'} → ${b.testsHead} tests passed.`
      : 'The same checks pass on main and on the change.',
  ].map(esc);
  if (b.mutation)
    items.push(
      `${b.mutation.caught ? 'Planted bug caught' : 'Planted bug missed'} in <code>${esc(b.mutation.file)}</code>: <code>${esc(b.mutation.find.trim().slice(0, 60))}</code> → <code>${esc(b.mutation.replace.trim().slice(0, 60))}</code>. ${esc(b.mutation.why)}`,
    );
  let html = `<h3>Proof: it breaks nothing</h3><ul class="proof">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
  const imp = proof.improvement;
  if (imp) {
    const rows = state.metrics
      .filter((m) => imp.before[m.id] !== undefined || imp.after[m.id] !== undefined)
      .map(
        (m) =>
          `<tr class="${imp.targets.includes(m.id) ? 'target' : ''}"><td>${esc(m.name)}${imp.targets.includes(m.id) ? ' <span class="chip kind">target</span>' : ''}</td><td>${fmt(imp.before[m.id])}</td><td>${fmt(imp.after[m.id])}</td><td>${delta(imp.before[m.id], imp.after[m.id])}</td></tr>`,
      )
      .join('');
    const s = imp.signals;
    html += `<h3>Proof: it makes the code better</h3>
      <p class="muted">Scored blind by ${imp.judges ?? 1} independent assessor${(imp.judges ?? 1) === 1 ? '' : 's'} (rubric <code>${esc(imp.rubric)}</code>), 0 worst to 100 best.</p>
      <table class="scores"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Lines ${s.before.lines} → ${s.after.lines} · nesting ${s.before.maxNesting} → ${s.after.maxNesting} · comments ${s.before.commentLines} → ${s.after.commentLines} · mocks ${s.before.mocks} → ${s.after.mocks} · suppressions ${s.before.suppressions} → ${s.after.suppressions}</p>
      <p>${chip(imp.improved ? 'improved' : 'not improved', imp.improved ? 'ok' : 'bad')} ${esc(imp.reason)}</p>`;
  }
  if (proof.rules)
    html += `<h3>Proof: it follows the repo's rules</h3><p class="muted">${proof.rules.sources.map((s) => `<code>${esc(s)}</code>`).join(' ') || 'No rule file found.'}</p><p>${esc(proof.rules.compliance)}</p>`;
  return html;
}

// ---------- scorecard ----------

function sparkline(values) {
  if (values.length < 2) return '';
  const w = 120;
  const h = 28;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / 4) * h).toFixed(1)}`)
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function scoreCell(score) {
  if (score === undefined) return '<td class="na">·</td>';
  return `<td><span class="score ${band(score.score)}">${pct(score.score)}%</span></td>`;
}

const TABLE_ROWS = 60;

function coverageHtml(c) {
  if (!c) return '';
  const share = c.totalLines ? Math.round((c.lines / c.totalLines) * 100) : 0;
  return `<div class="coverage"><div class="coverage-bar"><span style="width:${share}%"></span></div>
    <span>Scored ${c.files.toLocaleString()} of ${c.totalFiles.toLocaleString()} files · ${share}% of ${c.totalLines.toLocaleString()} lines. Each cycle scores more; <code>sloppatrol score --files N</code> scores more now.</span></div>`;
}

function renderScorecard() {
  const cards = state.scorecards;
  const current = cards.at(-1);
  if (!current) return empty('No scorecard yet. The first cycle scores the most changed and the largest files.');
  const previous = cards.at(-2);
  const means = Object.values(current.means);
  const mean = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : undefined);
  const overall = (c) => mean(Object.values(c.means));
  // Deltas compare like with like: only the files in both scorecards, so a
  // file that joined or left the panel does not read as a change in quality.
  // An older scorecard keeps its means only, so the like-for-like change compares
  // with the previous scorecard only when it still holds its files.
  const common = previous?.units.length
    ? current.units.filter((u) => previous.units.some((p) => p.path === u.path))
    : [];
  const pair = (metric) => {
    const units = common.filter(
      (u) => u.scores[metric] && previous.units.find((p) => p.path === u.path).scores[metric],
    );
    return [
      mean(units.map((u) => previous.units.find((p) => p.path === u.path).scores[metric].score)),
      mean(units.map((u) => u.scores[metric].score)),
    ];
  };
  const pairAll = () => {
    const pairs = state.metrics.map((m) => pair(m.id)).filter(([b, a]) => b !== undefined && a !== undefined);
    return [mean(pairs.map(([b]) => b)), mean(pairs.map(([, a]) => a))];
  };
  const overallTile = means.length
    ? `<div class="metric overall">
        <div class="metric-name">Overall</div>
        <div class="metric-value ${band(overall(current))}">${pct(overall(current))}<span class="of">%</span> ${delta(...pairAll())}</div>
        ${sparkline(cards.map(overall).filter((v) => v !== undefined))}
        <div class="metric-q">The mean of every metric below.</div>
      </div>`
    : '';
  const tiles = state.metrics
    .filter((m) => current.means[m.id] !== undefined)
    .map((m) => {
      const trend = cards.map((c) => c.means[m.id]).filter((v) => v !== undefined);
      return `<div class="metric" title="${esc(m.question)}">
        <div class="metric-name">${esc(m.name)}</div>
        <div class="metric-value ${band(current.means[m.id])}">${pct(current.means[m.id])}<span class="of">%</span> ${delta(...pair(m.id))}</div>
        ${sparkline(trend)}
        <div class="metric-q">${esc(m.question)}</div>
      </div>`;
    })
    .join('');
  const columns = state.metrics.map((m) => `<th title="${esc(m.question)}">${esc(m.name)}</th>`).join('');
  const shown = [...current.units].sort((a, b) => avg(a) - avg(b)).slice(0, TABLE_ROWS);
  const rows = shown
    .map(
      (u) =>
        `<tr class="${selected('unit', u.contentHash)}" data-select="unit:${esc(u.contentHash)}"><td class="path"><code>${esc(u.path)}</code></td>${state.metrics.map((m) => scoreCell(u.scores[m.id])).join('')}<td>${u.signals.lines}</td></tr>`,
    )
    .join('');
  const guardrails = (current.guardrails ?? [])
    .map(
      (g) =>
        `<span class="chip ${g.present ? 'ok' : 'bad'}" title="${esc(g.evidence)}"><span class="dot"></span>${esc(g.name)}</span>`,
    )
    .join('');
  return `<div class="metrics">${overallTile}${tiles}</div>
    ${guardrails ? `<h3 class="section">Repo guardrails</h3><div class="pills guardrails">${guardrails}</div>` : ''}
    ${coverageHtml(current.coverage)}
    <p class="muted">Commit <code>${esc(current.sha.slice(0, 10))}</code> · rubric <code>${esc(current.rubric)}</code> · ${shown.length < current.units.length ? `the ${shown.length} worst of ${current.units.length} scored files` : `${current.units.length} files, worst first`}${common.length ? ` · changes compare the ${common.length} files in both of the last two scorecards` : ''}</p>
    <table class="units"><thead><tr><th>File</th>${columns}<th>Lines</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function avg(unit) {
  const scores = Object.values(unit.scores).map((s) => s.score);
  return scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
}

function unitDetail(hash) {
  const unit = state.scorecards.at(-1)?.units.find((u) => u.contentHash === hash);
  if (!unit) return '<p>Not found.</p>';
  const s = unit.signals;
  return `<h2><code>${esc(unit.path)}</code></h2>
    <p class="muted">${s.lines} lines · nesting ${s.maxNesting} · ${s.commentLines} comment lines · ${s.mocks} mocks · ${s.suppressions} suppressions</p>
    ${state.metrics
      .filter((m) => unit.scores[m.id])
      .map((m) => {
        const score = unit.scores[m.id];
        return `<h3>${esc(m.name)} <span class="score ${band(score.score)}">${pct(score.score)}%</span></h3>
          <p class="muted">Level ${Math.round(score.score)} of 4: ${esc(m.levels[Math.round(score.score)])}</p><p>${esc(score.evidence)}</p>`;
      })
      .join('')}`;
}

// ---------- checks ----------

function checkPills(run) {
  const done = run.results.map((r) => chip(`${r.name} ${seconds(r.durationMs)}`, r.ok ? 'ok' : 'bad'));
  if (run.status === 'running' && run.current) done.push(chip(`${run.current}…`, 'run'));
  return `<div class="pills">${done.join('')}</div>`;
}

const PURPOSE = { base: 'main', gate: 'gate', refactorer: 'refactorer try', mutation: 'mutation' };

function renderChecks() {
  if (!state.checkRuns.length)
    return empty('No check run yet. The first cycle runs the checks on the patrolled commit.');
  return `<div class="list">${state.checkRuns
    .map((run) => {
      const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.parse(state.now);
      const took = seconds(end - Date.parse(run.startedAt));
      const where = run.branch ? `<code>${esc(run.branch)}</code>` : `<code>${esc(run.sha.slice(0, 10))}</code>`;
      return `<div class="row ${selected('check', run.id)}" data-select="check:${esc(run.id)}">
        <div class="row-head">${chip(run.status)}<span class="chip kind">${esc(PURPOSE[run.purpose])}</span><span class="row-title">${where}</span></div>
        ${checkPills(run)}
        <div class="row-sub"><span>started ${ago(run.startedAt)}</span><span>${run.status === 'running' ? 'running for' : 'took'} ${took}</span></div>
      </div>`;
    })
    .join('')}</div>`;
}

function checkDetail(id) {
  const run = fetched.get(`check:${id}`) ?? state.checkRuns.find((r) => r.id === id);
  if (!run) return '<p>Not found.</p>';
  return `
    <h2>Checks on ${run.branch ? esc(run.branch) : `main ${esc(run.sha.slice(0, 10))}`}</h2>
    <div class="pills">${chip(run.status)}<span class="chip kind">${esc(PURPOSE[run.purpose])}</span></div>
    ${run.results
      .map(
        (r) => `<h3>${r.ok ? '✓' : '✗'} ${esc(r.name)} · ${seconds(r.durationMs)}</h3>
        <p><code>${esc(r.command)}</code></p>
        ${r.output ? `<pre class="output">${esc(r.output)}</pre>` : '<p class="muted">No output.</p>'}`,
      )
      .join('')}
    ${run.status === 'running' && run.current ? `<h3>Running: ${esc(run.current)}</h3>` : ''}`;
}

// ---------- backlog ----------

/** An open opportunity with a verified branch waits to be published: show that. */
function backlogStatus(o) {
  const verified = state.refactors.some((r) => r.opportunityId === o.id && r.status === 'verified');
  return o.status === 'open' && verified ? 'verified' : o.status;
}

function renderBacklog() {
  const list = state.opportunities.filter((o) => backlogFilter === 'all' || backlogStatus(o) === backlogFilter);
  const filters = OPPORTUNITY_FILTERS.map((f) => {
    const n =
      f === 'all' ? state.opportunities.length : state.opportunities.filter((o) => backlogStatus(o) === f).length;
    return `<button data-filter="${f}" class="${f === backlogFilter ? 'active' : ''}">${f} ${n}</button>`;
  }).join('');
  const rows = list.length
    ? `<div class="list">${list
        .map(
          (o) => `<div class="row ${selected('opportunity', o.id)}" data-select="opportunity:${esc(o.id)}">
          <div class="row-head">${chip(backlogStatus(o))}<span class="row-title">${esc(o.title)}</span><span class="chip kind">${esc(o.kind)}</span></div>
          <div class="row-sub"><span>${esc(o.strength)}</span><span>${o.files.length} file${o.files.length === 1 ? '' : 's'}</span><span>${o.attempts} attempt${o.attempts === 1 ? '' : 's'}</span><span>found ${ago(o.createdAt)}</span></div>
        </div>`,
        )
        .join('')}</div>`
    : empty(`No ${backlogFilter === 'all' ? '' : `${backlogFilter} `}opportunity.`);
  return `<div class="filters">${filters}</div>${rows}`;
}

function opportunityDetail(o) {
  const refactors = state.refactors.filter((r) => r.opportunityId === o.id);
  return `
    <h2>${esc(o.title)}</h2>
    <div class="pills">${chip(backlogStatus(o))}<span class="chip kind">${esc(o.kind)}</span><span class="chip kind">${esc(o.strength)}</span></div>
    ${o.reason ? `<h3>Note</h3><p>${esc(o.reason)}</p>` : ''}
    <h3>Problem</h3><p>${esc(o.problem)}</p>
    <h3>Change</h3><p>${esc(o.change)}</p>
    <h3>Benefits</h3><p>${esc(o.benefits)}</p>
    <h3>Files</h3><div class="files">${o.files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>
    <h3>ID</h3><p><code>${esc(o.id)}</code> · <code>sloppatrol refactor ${esc(o.id)}</code></p>
    ${refactors.length ? `<h3>Attempts</h3>${refactors.map((r) => `<p><a href="#refactors" data-select="refactor:${esc(r.id)}">${esc(r.status)} · ${ago(r.updatedAt)}</a></p>`).join('')}` : ''}`;
}

// ---------- sessions ----------

function sessionRows(sessions) {
  return `<div class="list">${sessions
    .map(
      (s) => `<div class="row ${selected('session', s.id)}" data-select="session:${esc(s.id)}">
      <div class="row-head">${chip(s.state === 'done' ? 'done' : s.state)}<span class="chip kind">${esc(s.role)}</span><span class="row-title">${esc(s.last)}</span></div>
      <div class="row-sub"><span>started ${ago(s.startedAt)}</span>${s.costUsd ? `<span>$${s.costUsd.toFixed(2)}</span>` : ''}</div>
    </div>`,
    )
    .join('')}</div>`;
}

function renderSessions() {
  return state.sessions.length ? sessionRows(state.sessions) : empty('No agent session yet.');
}

function sessionDetail(id) {
  const summary = state.sessions.find((s) => s.id === id);
  const events = fetched.get(`session:${id}`) ?? [];
  const items = events
    .map((e) => {
      const text =
        e.kind === 'tool-call'
          ? `<span class="tool">${esc(e.tool)}</span>`
          : e.kind === 'tool-result'
            ? `<span class="tool">${esc(e.tool)}</span> → ${esc(e.summary)}`
            : `<span class="${e.kind === 'error' ? 'error' : ''}">${esc(e.summary)}</span>`;
      return `<li><time>${clock(e.at)}</time><div>${text}</div></li>`;
    })
    .join('');
  return `
    <h2>${esc(summary?.role ?? 'Session')}</h2>
    <div class="pills">${summary ? chip(summary.state) : ''}${summary?.subject ? `<span class="chip kind">${esc(summary.subject)}</span>` : ''}</div>
    <h3>Events</h3>
    ${items ? `<ul class="events">${items}</ul>` : '<p>Loading…</p>'}`;
}

// ---------- shell ----------

function empty(text) {
  return `<div class="empty">${esc(text)}</div>`;
}

function selected(type, id) {
  return selection?.type === type && selection.id === id ? 'selected' : '';
}

/** `#<tab>` or `#<tab>/<type>:<id>`, so a view and its detail can be linked. */
function tab() {
  const name = location.hash.slice(1).split('/')[0];
  return ['refactors', 'scorecard', 'checks', 'backlog', 'sessions'].includes(name) ? name : 'refactors';
}

async function loadSelection() {
  if (!selection) return;
  const { type, id } = selection;
  if (type === 'check') {
    const run = state.checkRuns.find((r) => r.id === id);
    const cached = fetched.get(`check:${id}`);
    if (!cached || cached.status === 'running' || run?.status === 'running')
      fetched.set(`check:${id}`, await (await fetch(`/api/checks/${id}`)).json());
  }
  if (type === 'session') {
    const summary = state.sessions.find((s) => s.id === id);
    if (!fetched.has(`session:${id}`) || summary?.state === 'running')
      fetched.set(`session:${id}`, await (await fetch(`/api/sessions/${id}`)).json());
  }
}

function renderDetail() {
  const panel = $('detail');
  if (!selection) {
    panel.hidden = true;
    return;
  }
  const { type, id } = selection;
  const body =
    type === 'refactor'
      ? refactorDetail(state.refactors.find((r) => r.id === id) ?? {})
      : type === 'opportunity'
        ? opportunityDetail(state.opportunities.find((o) => o.id === id) ?? {})
        : type === 'check'
          ? checkDetail(id)
          : type === 'unit'
            ? unitDetail(id)
            : sessionDetail(id);
  panel.hidden = false;
  setHtml(panel, `<button class="close" data-close aria-label="Close">×</button>${body}`);
}

function render() {
  if (!state) return;
  renderTop();
  const current = tab();
  for (const link of document.querySelectorAll('.tabs a')) {
    link.classList.toggle('active', link.dataset.tab === current);
  }
  const views = {
    refactors: renderRefactors,
    scorecard: renderScorecard,
    checks: renderChecks,
    backlog: renderBacklog,
    sessions: renderSessions,
  };
  setHtml($('view'), views[current]());
  renderDetail();
}

async function refresh() {
  try {
    state = await (await fetch('/api/state')).json();
    await loadSelection();
    render();
  } catch {
    $('meta').textContent = 'Cannot reach the Sloppatrol dashboard server.';
  }
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-select], [data-filter], [data-close], [data-session]');
  if (!target) return;
  if (target.dataset.close !== undefined) selection = undefined;
  else if (target.dataset.filter) backlogFilter = target.dataset.filter;
  else if (target.dataset.session) selection = { type: 'session', id: target.dataset.session };
  else {
    const [type, id] = target.dataset.select.split(':');
    selection = { type, id };
    history.replaceState(null, '', `#${tab()}/${type}:${id}`);
  }
  await loadSelection();
  render();
});

function selectFromHash() {
  const link = location.hash.slice(1).split('/')[1];
  if (!link) return;
  const [type, id] = decodeURIComponent(link).split(':');
  if (type && id) selection = { type, id };
}

window.addEventListener('hashchange', () => {
  selectFromHash();
  loadSelection().then(render);
});
selectFromHash();
refresh();
setInterval(refresh, 2000);
