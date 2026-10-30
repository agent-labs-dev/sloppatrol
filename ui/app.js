// The Sloppatrol dashboard: reads /api/state every two seconds and renders
// the overview, the refactors with their gate, the scorecard, the check
// runs, the backlog and the agent sessions. Read-only. The server computes
// every number once (`state.summary`); the pages only show them.

const TABS = ['overview', 'refactors', 'scorecard', 'checks', 'backlog', 'sessions'];
const ROLES = [
  ['patrol', 'Patrol'],
  ['surveyor', 'Surveyor'],
  ['refactorer', 'Refactorer'],
  ['assessor', 'Assessor'],
  ['gate', 'Gate'],
  ['reviewer', 'Reviewer'],
];

let state;
let selection; // { type: 'refactor' | 'check' | 'opportunity' | 'session' | 'unit', id }
const filters = { refactors: 'all', scorecard: 'all', checks: 'all', backlog: 'open', sessions: 'all' };
/** The groups a person closed, by id, so a refresh keeps them closed. */
const closed = new Set(['refactors:merged', 'refactors:closed']);
const fetched = new Map(); // full check runs and session events, by key

const $ = (id) => document.getElementById(id);

// ---------- theme ----------
// The choice cycles system → light → dark. "System" follows the OS setting, also when it changes.

const THEMES = ['system', 'light', 'dark'];
const THEME_WORDS = { system: 'System', light: 'Light', dark: 'Dark' };
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
const ICONS = {
  system: '<rect x="2" y="3" width="12" height="8" rx="1"/><path d="M6 14h4M8 11v3"/>',
  light:
    '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1"/>',
  dark: '<path d="M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z"/>',
  external: '<path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5"/>',
};
let themeChoice = THEMES.includes(localStorage.getItem('sloppatrol-theme'))
  ? localStorage.getItem('sloppatrol-theme')
  : 'system';

function icon(name) {
  return `<svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;
}

function applyTheme() {
  const theme = themeChoice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : themeChoice;
  document.documentElement.dataset.theme = theme;
  const next = THEMES[(THEMES.indexOf(themeChoice) + 1) % THEMES.length];
  const button = $('theme');
  button.innerHTML = icon(themeChoice);
  button.setAttribute('aria-label', `Theme: ${THEME_WORDS[themeChoice]}. Change the theme to ${THEME_WORDS[next]}.`);
  button.title = `Theme: ${THEME_WORDS[themeChoice]}. Click for ${THEME_WORDS[next]}.`;
}

$('theme').addEventListener('click', () => {
  themeChoice = THEMES[(THEMES.indexOf(themeChoice) + 1) % THEMES.length];
  if (themeChoice === 'system') localStorage.removeItem('sloppatrol-theme');
  else localStorage.setItem('sloppatrol-theme', themeChoice);
  applyTheme();
});
darkQuery.addEventListener('change', applyTheme);
applyTheme();

// ---------- words and numbers ----------

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const number = (n) => Number(n ?? 0).toLocaleString('en-US');

function plural(n, word, many = `${word}s`) {
  return `${number(n)} ${n === 1 ? word : many}`;
}

function capital(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

/** A coarse age, so the page does not change each second. */
function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.parse(state?.now ?? Date.now()) - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

function duration(ms) {
  if (ms === undefined || Number.isNaN(ms)) return '';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
  return `${Math.floor(ms / 3_600_000)} h ${Math.round((ms % 3_600_000) / 60_000)} min`;
}

function clock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const money = (usd) => `$${Number(usd ?? 0).toFixed(2)}`;
const short = (sha) => (sha ? sha.slice(0, 10) : '');

// ---------- shared blocks ----------

/** A status chip. The word carries the meaning; the color repeats it. */
function chip(text, tone = '') {
  return `<span class="chip ${tone}"><span class="dot" aria-hidden="true"></span>${esc(text)}</span>`;
}

function tag(text) {
  return `<span class="chip kind">${esc(text)}</span>`;
}

/** A row of numbers. A stat with a target is a button that opens its page. */
function statBand(stats) {
  return `<div class="band">${stats
    .filter(Boolean)
    .map(({ label, value, note, tone, go }) => {
      const body = `<span class="stat-label">${esc(label)}</span>
        <strong class="stat-value">${value}</strong>
        ${note ? `<span class="stat-note" title="${esc(note)}">${esc(note)}</span>` : ''}`;
      const cls = `stat${tone ? ` tone-${tone}` : ''}`;
      return go
        ? `<button type="button" class="${cls}" data-go="${esc(go)}">${body}</button>`
        : `<div class="${cls}">${body}</div>`;
    })
    .join('')}</div>`;
}

function commandBox(command) {
  return `<div class="command"><code>${esc(command)}</code><button type="button" class="copy" data-copy="${esc(command)}" aria-label="Copy the command ${esc(command)}">Copy</button></div>`;
}

/**
 * The one empty state of the dashboard: what the block shows, why it is
 * empty now, and the one next step as a command.
 */
function emptyState({ title, why, command, compact = false }) {
  return `<div class="empty-state${compact ? ' compact' : ''}">
    <h3>${esc(title)}</h3>
    <p>${esc(why)}</p>
    ${command ? commandBox(command) : ''}
  </div>`;
}

function card(title, aside, body, cls = '') {
  return `<section class="card ${cls}">
    <div class="card-head"><h2>${esc(title)}</h2>${aside ? `<span class="muted">${aside}</span>` : ''}</div>
    ${body}
  </section>`;
}

/** A group of rows that a person can close. */
function group(id, title, count, body, tone = '') {
  const open = !closed.has(id);
  return `<details class="group" data-group="${esc(id)}" ${open ? 'open' : ''}>
    <summary><span class="group-title ${tone}">${esc(title)}</span><span class="count">${number(count)}</span></summary>
    <div class="list">${body}</div>
  </details>`;
}

/** Filter buttons with counts. A button with no item is still there, so the set stays the same. */
function filterBar(page, options) {
  return `<div class="filters" role="group" aria-label="Filter">${options
    .map(
      ({ id, label, count }) =>
        `<button type="button" data-filter="${page}:${id}" aria-pressed="${filters[page] === id}" class="${filters[page] === id ? 'active' : ''}">${esc(label)}${count === undefined ? '' : ` <span class="count">${number(count)}</span>`}</button>`,
    )
    .join('')}</div>`;
}

function sparkline(values, max = 100) {
  if (values.length < 2) return '';
  const w = 96;
  const h = 24;
  const points = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${points}" /></svg>`;
}

function delta(n, unit = '') {
  if (n === undefined) return '';
  const cls = n > 0 ? 'up' : n < 0 ? 'down' : '';
  const word = n > 0 ? 'up' : n < 0 ? 'down' : 'no change';
  return `<span class="delta ${cls}" title="${word} since the scorecard before">${n > 0 ? '▲' : n < 0 ? '▼' : '±'}${Math.abs(n)}${unit}</span>`;
}

/** The colour band of a 0-100 score. */
function band(pct) {
  return pct < 40 ? 'low' : pct < 70 ? 'mid' : 'high';
}

const pct = (score) => Math.round((score / 4) * 100);

function bar(parts) {
  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (!total) return '';
  return `<div class="bar" role="img" aria-label="${esc(parts.map((p) => `${p.value} ${p.label}`).join(', '))}">${parts
    .filter((p) => p.value)
    .map(
      (p) => `<span class="bar-${p.tone}" style="flex-grow:${p.value}" title="${esc(`${p.value} ${p.label}`)}"></span>`,
    )
    .join('')}</div>`;
}

// ---------- lookups ----------

const opportunityById = (id) => state.opportunities.find((o) => o.id === id);
const refactorById = (id) => state.refactors.find((r) => r.id === id);

/** What a session works on, in words. */
function subjectWords(subject) {
  if (!subject) return '';
  const [kind, id] = subject.split(':');
  if (kind === 'refactor') return refactorById(id)?.title ?? `Refactor ${id}`;
  if (kind === 'survey') return `Survey of ${short(id)}`;
  if (kind === 'score') return `Scores of ${short(id)}`;
  return subject;
}

const OUTCOME = {
  working: ['in progress', 'run'],
  waits: ['waits for you', 'warn'],
  rejected: ['rejected', 'bad'],
  error: ['error', 'bad'],
  interrupted: ['interrupted', 'stop'],
  merged: ['merged', 'ok'],
  closed: ['closed', ''],
};

function outcomeChip(r) {
  if (r.status === 'verified') return chip('to publish', 'warn');
  if (r.status === 'published') return chip('pull request open', 'warn');
  const [text, tone] = OUTCOME[r.outcome];
  return chip(text, tone);
}

function stepper(r) {
  const marks = { ok: '✓', bad: '✗', run: '•', wait: '…', '': '' };
  const words = { ok: 'passed', bad: 'failed', run: 'running', wait: 'waits', '': 'not reached' };
  return `<ol class="steps" aria-label="Pipeline">${r.steps
    .map(
      (s) =>
        `<li class="step ${s.state}"><span class="mark" aria-hidden="true">${marks[s.state]}</span>${esc(s.label)}<span class="sr-only">: ${words[s.state]}</span></li>`,
    )
    .join('')}</ol>`;
}

// ---------- top bar ----------

function renderTop() {
  $('project').textContent = state.project;
  const a = state.summary.activity;
  const tone = { running: 'run', waiting: 'ok', stopped: '' }[a.state];
  const title = a.state === 'stopped' ? 'No Sloppatrol process runs now. Start a patrol with: sloppatrol' : a.detail;
  setHtml(
    $('activity'),
    `<span class="chip ${tone}" title="${esc(title)}"><span class="dot" aria-hidden="true"></span>${esc(a.text)}</span>`,
  );
}

// ---------- overview ----------

function confidenceBand() {
  const s = state.summary;
  const main = s.main;
  const waits = s.decisions.toPublish + s.decisions.toReview;
  const q = s.quality;
  const last = s.cycles.last;
  return statBand([
    { label: 'Status', value: esc(s.verdict.text), note: s.verdict.detail, tone: s.verdict.tone },
    {
      label: 'Checks on main',
      value: main ? (main.state === 'passed' ? 'Pass' : main.state === 'failed' ? 'Fail' : 'Running') : '–',
      note: main
        ? main.failed
          ? `${main.failed} fails on ${short(main.sha)}`
          : `On ${short(main.sha)}, ${ago(main.at)}`
        : 'No run yet',
      tone: main?.state === 'failed' ? 'fail' : main?.state === 'passed' ? 'pass' : undefined,
      go: 'checks:main',
    },
    {
      label: 'Waits for you',
      value: number(waits),
      note: waits
        ? [
            s.decisions.toPublish && `${s.decisions.toPublish} to publish`,
            s.decisions.toReview && `${plural(s.decisions.toReview, 'pull request')} to review`,
          ]
            .filter(Boolean)
            .join(' · ')
        : 'No decision waits',
      tone: waits ? 'warn' : undefined,
      go: 'refactors:waits',
    },
    {
      label: 'Backlog',
      value: number(s.backlog.open),
      note: s.backlog.open
        ? main?.state === 'failed'
          ? 'None can start while main fails'
          : `${s.backlog.ready.length} ready · ${s.backlog.byStrength.strong} strong`
        : 'No open opportunity',
      go: 'backlog:open',
    },
    {
      label: 'Code quality',
      value: q?.overall !== undefined ? `${q.overall}% ${delta(q.delta)}` : '–',
      note: q ? `${number(q.coverage.files)} of ${plural(q.coverage.totalFiles, 'file')} scored` : 'No scorecard yet',
      go: 'scorecard',
    },
    {
      label: 'Last cycle',
      value: last ? esc(ago(last.at)) : '–',
      note: last ? last.text : `${plural(s.cycles.count, 'cycle')}`,
      tone: last?.tone === 'fail' ? 'fail' : undefined,
    },
  ]);
}

function attentionItem(item) {
  const links = (item.links ?? [])
    .map(
      (l) =>
        `<li><button type="button" class="link" data-select="${esc(l.select)}">${esc(l.label)}</button>${l.href ? ` <a class="external" href="${esc(l.href)}" target="_blank" rel="noreferrer" aria-label="Open the pull request on GitHub" title="Open the pull request on GitHub">${icon('external')}</a>` : ''}</li>`,
    )
    .join('');
  const target = item.target ? `${item.target.tab}${item.target.filter ? `:${item.target.filter}` : ''}` : '';
  return `<li class="attention ${item.tone}">
    <div class="attention-head">
      <strong>${esc(item.title)}</strong>
      ${target && !item.target.select ? `<button type="button" class="link" data-go="${esc(target)}">Show</button>` : ''}
      ${item.target?.select ? `<button type="button" class="link" data-select="${esc(item.target.select)}">Show</button>` : ''}
    </div>
    <p>${esc(item.detail)}</p>
    ${links ? `<ul class="links">${links}</ul>` : ''}
    ${item.command ? commandBox(item.command) : ''}
  </li>`;
}

function agentsCard() {
  const byRole = Object.fromEntries(state.statuses.map((s) => [s.role, s]));
  const rows = ROLES.map(([role, label]) => {
    const s = byRole[role];
    const word = !s ? 'not started' : s.stale ? 'stopped' : s.state;
    const tone = { running: 'run', done: 'ok', failed: 'bad', stopped: 'stop' }[word] ?? '';
    const body = `<span class="agent-name">${esc(label)}</span>${chip(word, tone)}
      <span class="agent-detail">${esc(s?.stale ? 'Stopped without an end. The next patrol cleans up.' : (s?.detail ?? 'No work yet.'))}</span>
      <span class="agent-time">${s ? ago(s.updatedAt) : ''}</span>`;
    return s?.sessionId
      ? `<button type="button" class="agent" data-select="session:${esc(s.sessionId)}" aria-label="${esc(`${label}: ${word}. Open its session.`)}">${body}</button>`
      : `<div class="agent">${body}</div>`;
  }).join('');
  return card('Agents', '', `<div class="agents">${rows}</div>`);
}

function qualityCard() {
  const q = state.summary.quality;
  if (!q)
    return card(
      'Code quality',
      '',
      emptyState({
        title: 'No scorecard yet',
        why: 'The assessor scores the files of main in each cycle.',
        command: 'sloppatrol score',
        compact: true,
      }),
    );
  const rows = q.metrics
    .map(
      (m) => `<li><span>${esc(m.name)}</span>
      <span class="meter" aria-hidden="true"><span class="${band(m.value)}" style="width:${m.value}%"></span></span>
      <span class="num">${m.value}%</span>${delta(m.delta) || '<span></span>'}</li>`,
    )
    .join('');
  return card(
    'Code quality',
    `<button type="button" class="link" data-go="scorecard">Scorecard</button>`,
    `<ul class="meters">${rows}</ul>
     <p class="muted small">${number(q.coverage.files)} of ${plural(q.coverage.totalFiles, 'file')} scored (${q.coverage.share}% of the lines) on ${short(q.sha)}.</p>`,
  );
}

function outcomesCard() {
  const r = state.summary.refactors;
  if (!r.total) return card('Refactor results', '', emptyState({ ...refactorsEmpty(), compact: true }));
  const parts = [
    { label: 'merged', value: r.merged, tone: 'ok' },
    { label: 'wait for you', value: r.waits, tone: 'warn' },
    { label: 'closed', value: r.closed, tone: 'idle' },
    { label: 'rejected by the gate', value: r.rejected, tone: 'bad' },
    { label: 'stopped with an error', value: r.error, tone: 'stop' },
  ];
  const steps = r.rejectedBy
    .map((s) => `<li><span>Rejected at ${esc(s.label)}</span><span class="num">${number(s.count)}</span></li>`)
    .join('');
  return card(
    'Refactor results',
    `<button type="button" class="link" data-go="refactors">Refactors</button>`,
    `<p class="big">${r.keptRate === undefined ? '–' : `${r.keptRate}%`} <span class="muted">of judged refactors kept (${number(r.kept)} of ${number(r.judged)})</span></p>
     ${bar(parts)}
     <div class="legend">${parts.map((p) => `<span><i class="bar-${p.tone}" aria-hidden="true"></i>${number(p.value)} ${esc(p.label)}</span>`).join('')}</div>
     ${steps ? `<ul class="tally">${steps}</ul>` : ''}`,
  );
}

function renderOverview() {
  const s = state.summary;
  if (s.verdict.text === 'Not started')
    return `${confidenceBand()}<div class="card">${emptyState({
      title: 'Sloppatrol has not run on this repo yet',
      why: 'Run one cycle. It runs your checks on main, scores the code, records the first opportunities, and tries the best one. If you are not sure that the setup is complete, run sloppatrol doctor first.',
      command: 'sloppatrol --once',
    })}</div>`;
  const attention = s.attention.length
    ? `<ul class="attention-list">${s.attention.map(attentionItem).join('')}</ul>`
    : emptyState({
        title: 'Nothing needs attention',
        why: 'The checks pass on main, no refactor waits for you, and no agent failed in the last 7 days.',
        command: 'sloppatrol --once',
        compact: true,
      });
  const recent = state.refactors.slice(0, 5);
  return `${confidenceBand()}
    <div class="grid two">
      ${card('Needs attention', s.attention.length ? plural(s.attention.length, 'item') : '', attention, 'attention-card')}
      ${agentsCard()}
    </div>
    <div class="grid two">
      ${qualityCard()}
      ${outcomesCard()}
    </div>
    ${
      recent.length
        ? card(
            'Recent refactors',
            `<button type="button" class="link" data-go="refactors">All ${number(s.refactors.total)}</button>`,
            `<div class="list">${recent.map(refactorRowHtml).join('')}</div>`,
          )
        : ''
    }`;
}

// ---------- refactors ----------

function refactorsEmpty() {
  const s = state.summary;
  if (s.main?.state === 'failed')
    return {
      title: 'No refactor can start',
      why: `The check ${s.main.failed} fails on main. The gate needs green checks on main to verify a refactor. Fix main, then run the checks again.`,
      command: 'sloppatrol check',
    };
  if (!s.backlog.total)
    return {
      title: 'No refactor yet',
      why: 'The refactorer works on the opportunities that the surveyor records. The backlog is empty.',
      command: 'sloppatrol survey',
    };
  return {
    title: 'No refactor yet',
    why: `${plural(s.backlog.open, 'opportunity', 'opportunities')} ${s.backlog.open === 1 ? 'waits' : 'wait'} for the refactorer. Try the best one now.`,
    command: 'sloppatrol refactor',
  };
}

function refactorRowHtml(r) {
  const stat = r.diffStat ? `+${r.diffStat.added} −${r.diffStat.removed} in ${plural(r.diffStat.files, 'file')}` : '';
  const why =
    r.rejectedAt && r.reason
      ? `Rejected at ${r.steps.find((s) => s.id === r.rejectedAt)?.label ?? r.rejectedAt}: ${r.reason.split('\n')[0]}`
      : ['error', 'interrupted'].includes(r.outcome) && r.reason
        ? r.reason.split('\n')[0]
        : '';
  return `<button type="button" class="row ${selected('refactor', r.id)}" data-select="refactor:${esc(r.id)}">
    <span class="row-head">${outcomeChip(r)}<span class="row-title">${esc(r.title)}</span>${r.kind ? tag(r.kind) : ''}</span>
    ${stepper(r)}
    <span class="row-sub"><span>${ago(r.updatedAt)}</span>${stat ? `<span>${stat}</span>` : ''}${why ? `<span class="why">${esc(why.slice(0, 160))}</span>` : ''}</span>
  </button>`;
}

const REFACTOR_GROUPS = [
  ['working', 'In progress', (r) => r.outcome === 'working', 'run'],
  ['waits', 'Waits for you', (r) => r.outcome === 'waits', 'warn'],
  ['error', 'Stopped with an error', (r) => r.outcome === 'error' || r.outcome === 'interrupted', 'bad'],
  ['rejected', 'Rejected by the gate', (r) => r.outcome === 'rejected', 'bad'],
  ['merged', 'Merged', (r) => r.outcome === 'merged', 'ok'],
  ['closed', 'Closed without a merge', (r) => r.outcome === 'closed', ''],
];

function renderRefactors() {
  const r = state.summary.refactors;
  const numbers = statBand([
    { label: 'Attempts', value: number(r.total), note: `${plural(r.judged, 'refactor')} judged by the gate` },
    {
      label: 'Kept',
      value: r.keptRate === undefined ? '–' : `${r.keptRate}%`,
      note: `${number(r.kept)} of ${number(r.judged)} passed the gate`,
      tone: r.keptRate === undefined ? undefined : r.keptRate >= 50 ? 'pass' : 'warn',
    },
    {
      label: 'Waits for you',
      value: number(r.waits),
      note: `${state.summary.decisions.toPublish} to publish · ${state.summary.decisions.toReview} to review`,
      tone: r.waits ? 'warn' : undefined,
      go: 'refactors:waits',
    },
    { label: 'Merged', value: number(r.merged), go: 'refactors:merged' },
    {
      label: 'Rejected',
      value: number(r.rejected),
      note: r.rejectedBy[0] ? `Most at ${r.rejectedBy[0].label} (${r.rejectedBy[0].count})` : 'None',
      go: 'refactors:rejected',
    },
    { label: 'Errors', value: number(r.error), tone: r.error ? 'fail' : undefined, go: 'refactors:error' },
  ]);
  if (!state.refactors.length) return `${numbers}<div class="card">${emptyState(refactorsEmpty())}</div>`;
  const counts = Object.fromEntries(REFACTOR_GROUPS.map(([id, , test]) => [id, state.refactors.filter(test).length]));
  const bar = filterBar('refactors', [
    { id: 'all', label: 'All', count: state.refactors.length },
    ...REFACTOR_GROUPS.map(([id, label]) => ({ id, label, count: counts[id] })),
  ]);
  const shown = REFACTOR_GROUPS.filter(([id]) => filters.refactors === 'all' || filters.refactors === id);
  const groups = shown
    .map(([id, label, test, tone]) => {
      const list = state.refactors.filter(test);
      if (!list.length) return '';
      return group(`refactors:${id}`, label, list.length, list.map(refactorRowHtml).join(''), tone);
    })
    .join('');
  return `${numbers}${bar}${
    groups ||
    emptyState({
      title: 'No refactor in this group',
      why: 'No refactor has this result now. Select All to see each refactor.',
      compact: true,
    })
  }`;
}

function refactorDetail(r) {
  if (!r) return '<p>This refactor is not in the data.</p>';
  const o = opportunityById(r.opportunityId);
  const v = r.verdict;
  const gate = v?.checkRunId ?? state.checkRuns.find((c) => c.refactorId === r.id && c.purpose === 'gate')?.id;
  const sessions = state.sessions.filter((s) => s.subject === `refactor:${r.id}`);
  return `
    <h2>${esc(r.title)}</h2>
    <div class="pills">${outcomeChip(r)}${o ? `${tag(o.kind)}${tag(`${o.side} only`)}` : ''}</div>
    ${stepper(r)}
    ${r.status === 'verified' ? `<h3>Next step</h3><p>The gate kept this refactor. Publish it to open its pull request.</p>${commandBox('sloppatrol publish')}` : ''}
    ${r.prUrl ? `<h3>Pull request</h3><p><a href="${esc(r.prUrl)}" target="_blank" rel="noreferrer">${esc(r.prUrl)}</a></p>` : ''}
    ${r.reason ? `<h3>Reason</h3><p>${esc(r.reason)}</p>` : ''}
    ${r.summary ? `<h3>What changed</h3><p>${esc(r.summary)}</p>` : ''}
    ${o ? `<h3>Files</h3><div class="files">${o.files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>` : ''}
    ${v?.guards?.length ? `<h3>Guard findings</h3>${v.guards.map((g) => `<p>✗ <b>${esc(g.guard)}</b> ${g.file ? `<code>${esc(g.file)}</code> ` : ''}${esc(g.detail)}</p>`).join('')}` : ''}
    ${gate ? `<h3>Gate checks</h3><p><button type="button" class="link" data-select="check:${esc(gate)}">Open the check run</button></p>` : ''}
    ${r.proof ? proofHtml(r.proof) : ''}
    ${v?.review ? `<h3>Review: ${v.review.approve ? 'approved' : 'rejected'}</h3><p>${esc(v.review.reasons)}</p>` : ''}
    <h3>Branch</h3><p><code>${esc(r.branch)}</code> from <code>${esc(short(r.baseSha))}</code></p>
    ${sessions.length ? `<h3>Agent sessions</h3><div class="list">${sessions.map(sessionRowHtml).join('')}</div>` : ''}`;
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
      .map((m) => {
        const target = imp.targets.includes(m.id);
        const change =
          imp.before[m.id] !== undefined && imp.after[m.id] !== undefined
            ? delta(pct(imp.after[m.id]) - pct(imp.before[m.id]))
            : '';
        return `<tr class="${target ? 'target' : ''}"><td>${esc(m.name)}${target ? ` ${tag('target')}` : ''}</td><td>${fmt(imp.before[m.id])}</td><td>${fmt(imp.after[m.id])}</td><td>${change}</td></tr>`;
      })
      .join('');
    const s = imp.signals;
    html += `<h3>Proof: it makes the code better</h3>
      <p class="muted">${plural(imp.judges ?? 1, 'independent assessor')} scored it blind (rubric <code>${esc(imp.rubric)}</code>), 0 worst to 100 best.</p>
      <table class="scores"><thead><tr><th>Metric</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${rows}</tbody></table>
      <p class="muted">Lines ${s.before.lines} → ${s.after.lines} · nesting ${s.before.maxNesting} → ${s.after.maxNesting} · comments ${s.before.commentLines} → ${s.after.commentLines} · mocks ${s.before.mocks} → ${s.after.mocks} · suppressions ${s.before.suppressions} → ${s.after.suppressions}</p>
      <p>${chip(imp.improved ? 'improved' : 'not improved', imp.improved ? 'ok' : 'bad')} ${esc(imp.reason)}</p>`;
  }
  if (proof.rules)
    html += `<h3>Proof: it follows the repo's rules</h3><p class="muted">${proof.rules.sources.map((s) => `<code>${esc(s)}</code>`).join(' ') || 'No rule file found.'}</p><p>${esc(proof.rules.compliance)}</p>`;
  return html;
}

// ---------- scorecard ----------

const TABLE_ROWS = 80;

function avg(unit) {
  const scores = Object.values(unit.scores).map((s) => s.score);
  return scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
}

function renderScorecard() {
  const q = state.summary.quality;
  const current = state.scorecards.at(-1);
  if (!q || !current)
    return `<div class="card">${emptyState({
      title: 'No scorecard yet',
      why:
        state.summary.main?.state === 'failed'
          ? 'Each cycle scores the files of main, but the checks fail on main now. Score the code now, also while main is red.'
          : 'Each cycle scores the most changed and the largest files of main first. Score the code now to start.',
      command: 'sloppatrol score',
    })}</div>`;
  const lowest = [...q.metrics].sort((a, b) => a.value - b.value)[0];
  const numbers = statBand([
    {
      label: 'Overall',
      value: `${q.overall ?? '–'}% ${delta(q.delta)}`,
      note: q.compared
        ? `Change over the ${plural(q.compared, 'file')} in both of the last two scorecards`
        : 'The mean of each metric',
      tone: q.overall === undefined ? undefined : q.overall >= 70 ? 'pass' : q.overall >= 40 ? 'warn' : 'fail',
    },
    {
      label: 'Files scored',
      value: `${number(q.coverage.files)} <span class="of">of ${number(q.coverage.totalFiles)}</span>`,
      note: `${q.coverage.share}% of the lines`,
    },
    lowest
      ? {
          label: 'Lowest metric',
          value: esc(lowest.name),
          note: `${lowest.value}%`,
          tone: lowest.value < 40 ? 'fail' : 'warn',
        }
      : null,
    {
      label: 'Guardrails',
      value: `${q.guardrails.present} <span class="of">of ${q.guardrails.total}</span>`,
      note:
        q.guardrails.present < q.guardrails.total
          ? `${q.guardrails.total - q.guardrails.present} missing`
          : 'All present',
    },
    { label: 'Scored', value: esc(ago(q.at)), note: `Commit ${short(q.sha)} · rubric ${q.rubric}` },
  ]);
  const tiles = q.metrics
    .map((m) => {
      const meta = state.metrics.find((x) => x.id === m.id);
      return `<div class="metric" title="${esc(meta?.question)}">
        <div class="metric-name">${esc(m.name)}</div>
        <div class="metric-value"><span class="score-text ${band(m.value)}">${m.value}%</span> ${delta(m.delta)}</div>
        ${sparkline(m.trend)}
      </div>`;
    })
    .join('');
  const coverage =
    q.coverage.share < 100
      ? `<div class="callout"><p>The scores cover ${q.coverage.share}% of the lines. Each cycle scores more files. Score more files now:</p>${commandBox('sloppatrol score --files 50')}</div>`
      : '';
  const guardrails = [...(current.guardrails ?? [])]
    .sort((a, b) => Number(a.present) - Number(b.present))
    .map(
      (g) =>
        `<li class="${g.present ? 'ok' : 'bad'}"><span class="mark" aria-hidden="true">${g.present ? '✓' : '✗'}</span><b>${esc(g.name)}</b><span class="muted">${g.present ? '' : 'Missing: '}${esc(g.evidence)}</span></li>`,
    )
    .join('');
  const units = current.units;
  const isTest = (u) => u.scores.tests !== undefined;
  const tests = units.filter(isTest).length;
  const low = units.filter((u) => pct(avg(u)) < 50).length;
  const list = units
    .filter((u) =>
      filters.scorecard === 'low'
        ? pct(avg(u)) < 50
        : filters.scorecard === 'tests'
          ? isTest(u)
          : filters.scorecard === 'source'
            ? !isTest(u)
            : true,
    )
    .sort((a, b) => avg(a) - avg(b));
  const shown = list.slice(0, TABLE_ROWS);
  const columns = state.metrics.map((m) => `<th scope="col" title="${esc(m.question)}">${esc(m.name)}</th>`).join('');
  const cell = (score) =>
    score === undefined
      ? '<td class="na"><span class="sr-only">does not apply</span>·</td>'
      : `<td><span class="score ${band(pct(score.score))}">${pct(score.score)}</span></td>`;
  const rows = shown
    .map(
      (u) =>
        `<tr class="${selected('unit', u.contentHash)}"><th scope="row" class="path"><button type="button" class="link" data-select="unit:${esc(u.contentHash)}" title="${esc(u.path)}">${esc(u.path)}</button></th>${state.metrics.map((m) => cell(u.scores[m.id])).join('')}<td class="num">${number(u.signals.lines)}</td></tr>`,
    )
    .join('');
  const table = shown.length
    ? `<div class="table-wrap"><table class="units"><thead><tr><th scope="col">File, lowest first</th>${columns}<th scope="col">Lines</th></tr></thead><tbody>${rows}</tbody></table></div>
       ${list.length > shown.length ? `<p class="muted small">The table shows the ${shown.length} lowest of ${number(list.length)} files.</p>` : ''}`
    : emptyState({
        title: 'No file in this group',
        why: 'No scored file matches this filter. Select All to see each file.',
        compact: true,
      });
  return `${numbers}
    <div class="metrics">${tiles}</div>
    ${coverage}
    <div class="grid two narrow-right">
      <section class="card">
        <div class="card-head"><h2>Files</h2><span class="muted">Each score is 0 worst to 100 best</span></div>
        ${filterBar('scorecard', [
          { id: 'all', label: 'All', count: units.length },
          { id: 'low', label: 'Below 50', count: low },
          { id: 'source', label: 'Source', count: units.length - tests },
          { id: 'tests', label: 'Tests', count: tests },
        ])}
        ${table}
      </section>
      ${card('Repo guardrails', `${q.guardrails.present} of ${q.guardrails.total}`, `<ul class="guardrails">${guardrails}</ul>`)}
    </div>`;
}

function unitDetail(hash) {
  const unit = state.scorecards.at(-1)?.units.find((u) => u.contentHash === hash);
  if (!unit) return '<p>This file is not in the newest scorecard.</p>';
  const s = unit.signals;
  return `<h2><code>${esc(unit.path)}</code></h2>
    <p class="muted">${s.lines} lines · nesting ${s.maxNesting} · ${s.commentLines} comment lines · ${s.mocks} mocks · ${s.suppressions} suppressions</p>
    ${state.metrics
      .filter((m) => unit.scores[m.id])
      .map((m) => {
        const score = unit.scores[m.id];
        return `<h3>${esc(m.name)} <span class="score ${band(pct(score.score))}">${pct(score.score)}</span></h3>
          <p class="muted">Level ${Math.round(score.score)} of 4: ${esc(m.levels[Math.round(score.score)])}</p><p>${esc(score.evidence)}</p>`;
      })
      .join('')}`;
}

// ---------- checks ----------

const PURPOSE = { base: 'main', gate: 'gate', refactorer: 'refactorer try', mutation: 'mutation' };
const RUN_TONE = { ok: 'ok', bad: 'bad', run: 'run', stop: 'stop' };

function checkPills(run) {
  const done = run.results.map((r) => chip(`${r.name} ${duration(r.durationMs)}`, r.ok ? 'ok' : 'bad'));
  if (run.status === 'running' && run.current)
    done.push(chip(`${run.current}…`, run.outcome.tone === 'run' ? 'run' : 'stop'));
  return `<div class="pills">${done.join('')}</div>`;
}

function checkRowHtml(run) {
  const end = run.finishedAt ? Date.parse(run.finishedAt) : Date.parse(state.now);
  const took = duration(end - Date.parse(run.startedAt));
  const where =
    run.purpose === 'base'
      ? `main at ${short(run.sha)}`
      : (refactorById(run.refactorId)?.title ?? run.branch ?? short(run.sha));
  return `<button type="button" class="row ${selected('check', run.id)}" data-select="check:${esc(run.id)}">
    <span class="row-head">${chip(run.outcome.text, RUN_TONE[run.outcome.tone])}${tag(PURPOSE[run.purpose])}<span class="row-title">${esc(where)}</span></span>
    ${checkPills(run)}
    <span class="row-sub"><span>started ${ago(run.startedAt)}</span><span>${run.outcome.tone === 'run' ? 'running for' : 'took'} ${took}</span>${run.branch && run.purpose !== 'base' ? `<code>${esc(run.branch)}</code>` : ''}</span>
  </button>`;
}

function renderChecks() {
  const c = state.summary.checks;
  const main = state.summary.main;
  const numbers = statBand([
    {
      label: 'Checks on main',
      value: main ? (main.state === 'passed' ? 'Pass' : 'Fail') : '–',
      note: main
        ? main.failed
          ? `${main.failed} fails on ${short(main.sha)}`
          : `On ${short(main.sha)}`
        : 'No run yet',
      tone: main ? (main.state === 'passed' ? 'pass' : 'fail') : undefined,
      go: 'checks:main',
    },
    { label: 'Runs', value: number(c.runs), note: `${plural(c.problems, 'problem')}`, go: 'checks:bad' },
    {
      label: 'Gate',
      value: c.gate.runs ? `${Math.round(((c.gate.runs - c.gate.bad) / c.gate.runs) * 100)}%` : '–',
      note: `${number(c.gate.runs - c.gate.bad)} of ${plural(c.gate.runs, 'refactor')} passed`,
      go: 'checks:gate',
    },
    {
      label: 'Refactorer tries',
      value: number(c.refactorer.runs),
      note: `${number(c.refactorer.bad)} failed before the gate`,
      go: 'checks:refactorer',
    },
    {
      label: 'Planted bugs caught',
      value: c.planted ? `${c.caught} <span class="of">of ${c.planted}</span>` : '–',
      note: 'A tests refactor must catch its bug',
      go: 'checks:mutation',
    },
  ]);
  if (!state.checkRuns.length)
    return `${numbers}<div class="card">${emptyState({
      title: 'No check run yet',
      why: 'Sloppatrol runs your checks on main first. Green checks on main are the oracle for each refactor.',
      command: 'sloppatrol check',
    })}</div>`;
  const match = {
    all: () => true,
    bad: (r) => r.problem,
    main: (r) => r.purpose === 'base',
    gate: (r) => r.purpose === 'gate',
    refactorer: (r) => r.purpose === 'refactorer',
    mutation: (r) => r.purpose === 'mutation',
  };
  const list = state.checkRuns.filter(match[filters.checks]);
  const bar = filterBar('checks', [
    { id: 'all', label: 'All', count: c.runs },
    { id: 'bad', label: 'Problems', count: c.problems },
    { id: 'main', label: 'Main', count: c.base.runs },
    { id: 'gate', label: 'Gate', count: c.gate.runs },
    { id: 'refactorer', label: 'Refactorer', count: c.refactorer.runs },
    { id: 'mutation', label: 'Mutation', count: c.mutation.runs },
  ]);
  const problems = list.filter((r) => r.problem);
  const others = list.filter((r) => !r.problem);
  const body = !list.length
    ? emptyState({
        title: 'No run in this group',
        why: 'No recent check run matches this filter. Select All to see each run.',
        compact: true,
      })
    : filters.checks === 'all'
      ? `${problems.length ? group('checks:bad', 'Problems', problems.length, problems.map(checkRowHtml).join(''), 'bad') : ''}${group('checks:other', 'Other runs', others.length, others.map(checkRowHtml).join(''))}`
      : `<div class="list">${list.map(checkRowHtml).join('')}</div>`;
  const note =
    c.runs > state.checkRuns.length
      ? `<p class="muted small">The list shows the newest ${state.checkRuns.length} of ${number(c.runs)} runs. The numbers above count each run.</p>`
      : '';
  return `${numbers}${bar}${note}${body}`;
}

function checkDetail(id) {
  const row = state.checkRuns.find((r) => r.id === id);
  const run = { ...row, ...fetched.get(`check:${id}`) };
  if (!run.id) return '<p>Loading…</p>';
  return `
    <h2>Checks on ${run.purpose === 'base' ? `main ${esc(short(run.sha))}` : esc(run.branch ?? short(run.sha))}</h2>
    <div class="pills">${run.outcome ? chip(run.outcome.text, RUN_TONE[run.outcome.tone]) : ''}${tag(PURPOSE[run.purpose])}</div>
    ${run.purpose === 'mutation' ? '<p class="muted">A mutation run plants a bug in the source. A failed test here means that the tests caught the bug.</p>' : ''}
    ${run.refactorId ? `<p><button type="button" class="link" data-select="refactor:${esc(run.refactorId)}">Open the refactor</button></p>` : ''}
    ${run.results
      .map(
        (r) => `<h3>${r.ok ? '✓' : '✗'} ${esc(r.name)} · ${duration(r.durationMs)}</h3>
        <p><code>${esc(r.command)}</code></p>
        ${r.output ? `<pre class="output">${esc(r.output)}</pre>` : '<p class="muted">No output.</p>'}`,
      )
      .join('')}
    ${run.status === 'running' && run.current ? `<h3>Now: ${esc(run.current)}</h3>` : ''}`;
}

// ---------- backlog ----------

const BACKLOG_FILTERS = [
  ['open', 'Open'],
  ['verified', 'To publish'],
  ['proposed', 'Pull request open'],
  ['done', 'Done'],
  ['exhausted', 'Exhausted'],
  ['dismissed', 'Dismissed'],
  ['all', 'All'],
];

/** An open opportunity with a verified branch waits to be published. */
function backlogStatus(o) {
  const verified = state.refactors.some((r) => r.opportunityId === o.id && r.status === 'verified');
  return o.status === 'open' && verified ? 'verified' : o.status;
}

const STRENGTH = { strong: ['strong', 'ok'], 'worth-exploring': ['worth a try', ''], speculative: ['speculative', ''] };

function opportunityRowHtml(o, rank) {
  const status = state.summary.backlog.working.includes(o.id) ? 'in progress' : backlogStatus(o);
  return `<button type="button" class="row ${selected('opportunity', o.id)}" data-select="opportunity:${esc(o.id)}">
    <span class="row-head">${rank ? `<span class="rank" aria-label="Number ${rank} in the pick order">${rank}</span>` : chip(status, { done: 'ok', proposed: 'warn', verified: 'warn', exhausted: 'bad', 'in progress': 'run' }[status] ?? '')}<span class="row-title">${esc(o.title)}</span>${chip(...STRENGTH[o.strength])}${tag(o.kind)}</span>
    <span class="row-sub"><span>${esc(o.side)} only</span><span>${plural(o.files.length, 'file')}</span><span>${plural(o.attempts, 'attempt')}</span><span>found ${ago(o.createdAt)}</span>${o.reason && status !== 'done' ? `<span class="why">${esc(o.reason.split('\n')[0].slice(0, 140))}</span>` : ''}</span>
  </button>`;
}

function renderBacklog() {
  const b = state.summary.backlog;
  const numbers = statBand([
    {
      label: 'Open',
      value: number(b.open),
      note: `${b.byStrength.strong} strong · ${b.byStrength['worth-exploring']} worth a try · ${b.byStrength.speculative} speculative`,
      go: 'backlog:open',
    },
    {
      label: 'Ready',
      value: number(b.ready.length),
      note:
        state.summary.main?.state === 'failed'
          ? 'None can start while the checks fail on main'
          : 'The refactorer can take these now',
      tone: state.summary.main?.state === 'failed' && b.ready.length ? 'fail' : undefined,
    },
    {
      label: 'Waits for a file',
      value: number(b.busy.length),
      note: 'A refactor that waits for you changes its files',
    },
    {
      label: 'Done',
      value: number(b.done),
      note: `${number(b.proposed)} more in an open pull request`,
      go: 'backlog:done',
    },
    { label: 'Exhausted', value: number(b.exhausted), note: 'Each attempt failed the gate', go: 'backlog:exhausted' },
    { label: 'Dismissed', value: number(b.dismissed), go: 'backlog:dismissed' },
  ]);
  if (!state.opportunities.length)
    return `${numbers}<div class="card">${emptyState({
      title: 'The backlog is empty',
      why:
        state.summary.main?.state === 'failed'
          ? 'The surveyor records opportunities only while the checks pass on main. Fix main first.'
          : 'The surveyor reads the repo and records the improvements that it finds. Each cycle runs it when the backlog is low.',
      command: state.summary.main?.state === 'failed' ? 'sloppatrol check' : 'sloppatrol survey',
    })}</div>`;
  const counts = {
    open: b.open,
    verified: b.verified,
    proposed: b.proposed,
    done: b.done,
    exhausted: b.exhausted,
    dismissed: b.dismissed,
    all: b.total,
  };
  const bar = filterBar(
    'backlog',
    BACKLOG_FILTERS.map(([id, label]) => ({ id, label, count: counts[id] })),
  );
  let body;
  if (filters.backlog === 'open') {
    const ids = (list) => list.map(opportunityById).filter(Boolean);
    const working = ids(b.working);
    const ready = ids(b.ready);
    const busy = ids(b.busy);
    body =
      (working.length
        ? group(
            'backlog:working',
            'In progress now',
            working.length,
            working.map((o) => opportunityRowHtml(o)).join(''),
            'run',
          )
        : '') +
      (ready.length
        ? group(
            'backlog:ready',
            'Next for the refactorer, in pick order',
            ready.length,
            ready.map((o, i) => opportunityRowHtml(o, i + 1)).join(''),
          )
        : '') +
      (busy.length
        ? group(
            'backlog:busy',
            'Waits for a refactor that changes the same files',
            busy.length,
            busy.map((o) => opportunityRowHtml(o)).join(''),
            'warn',
          )
        : '');
    if (!body)
      body = emptyState({
        title: 'No open opportunity',
        why: 'The refactorer took or closed each opportunity. The surveyor records more when the backlog is low.',
        command: 'sloppatrol survey',
        compact: true,
      });
  } else {
    const list = state.opportunities.filter((o) => filters.backlog === 'all' || backlogStatus(o) === filters.backlog);
    body = list.length
      ? `<div class="list">${list.map((o) => opportunityRowHtml(o)).join('')}</div>`
      : emptyState({
          title: 'No opportunity in this group',
          why: 'No opportunity has this status now. Select All to see each one.',
          compact: true,
        });
  }
  return `${numbers}${bar}${body}`;
}

function opportunityDetail(o) {
  if (!o) return '<p>This opportunity is not in the data.</p>';
  const refactors = state.refactors.filter((r) => r.opportunityId === o.id);
  return `
    <h2>${esc(o.title)}</h2>
    <div class="pills">${chip(backlogStatus(o))}${tag(o.kind)}${tag(STRENGTH[o.strength][0])}</div>
    ${o.reason ? `<h3>Note</h3><p>${esc(o.reason)}</p>` : ''}
    <h3>Problem</h3><p>${esc(o.problem)}</p>
    <h3>Change</h3><p>${esc(o.change)}</p>
    <h3>Benefits</h3><p>${esc(o.benefits)}</p>
    <h3>Files</h3><div class="files">${o.files.map((f) => `<code>${esc(f)}</code>`).join('')}</div>
    ${o.status === 'open' ? `<h3>Try it now</h3>${commandBox(`sloppatrol refactor ${o.id}`)}<h3>Dismiss it</h3>${commandBox(`sloppatrol dismiss ${o.id} --reason "..."`)}` : ''}
    ${refactors.length ? `<h3>Attempts</h3><div class="list">${refactors.map(refactorRowHtml).join('')}</div>` : ''}`;
}

// ---------- sessions ----------

function sessionRowHtml(s) {
  const tone = { running: 'run', done: 'ok', failed: 'bad', stopped: 'stop' }[s.state];
  const took = s.endedAt ? duration(Date.parse(s.endedAt) - Date.parse(s.startedAt)) : '';
  return `<button type="button" class="row ${selected('session', s.id)}" data-select="session:${esc(s.id)}">
    <span class="row-head">${chip(s.state, tone)}${tag(s.role)}<span class="row-title">${esc(subjectWords(s.subject) || s.last)}</span></span>
    <span class="row-sub"><span>started ${ago(s.startedAt)}</span>${took ? `<span>took ${took}</span>` : ''}${s.costUsd ? `<span>${money(s.costUsd)}</span>` : ''}<span class="why">${esc(s.last)}</span></span>
  </button>`;
}

function renderSessions() {
  const s = state.summary.sessions;
  const numbers = statBand([
    { label: 'Sessions', value: number(s.total) },
    { label: 'Running', value: number(s.running), tone: s.running ? 'run' : undefined },
    {
      label: 'Failed',
      value: number(s.failed),
      note: `${number(s.failedRecent)} in the last 7 days`,
      tone: s.failedRecent ? 'fail' : undefined,
      go: 'sessions:failed',
    },
    {
      label: 'Stopped',
      value: number(s.stopped),
      note: 'Sloppatrol stopped during the session',
      go: 'sessions:stopped',
    },
    {
      label: 'Agent cost',
      value: money(s.costUsd),
      note: `${money(s.costRecentUsd)} in the last 7 days. Only the costs that the agent reports.`,
    },
  ]);
  if (!state.sessions.length)
    return `${numbers}<div class="card">${emptyState({
      title: 'No agent session yet',
      why: 'Each agent works in a session. Its tool calls show here as a timeline. A cycle starts the first sessions.',
      command: 'sloppatrol --once',
    })}</div>`;
  const roles = Object.keys(s.byRole);
  const bar = filterBar('sessions', [
    { id: 'all', label: 'All', count: s.total },
    { id: 'failed', label: 'Failed', count: s.failed },
    { id: 'stopped', label: 'Stopped', count: s.stopped },
    ...roles.map((role) => ({ id: role, label: capital(role), count: s.byRole[role] })),
  ]);
  const f = filters.sessions;
  const list = state.sessions.filter((x) => f === 'all' || x.state === f || x.role === f);
  const failed = list.filter((x) => x.state === 'failed');
  const others = list.filter((x) => x.state !== 'failed');
  const body = !list.length
    ? emptyState({
        title: 'No session in this group',
        why: 'No recent session matches this filter. Select All to see each session.',
        compact: true,
      })
    : f === 'all' && failed.length
      ? `${group('sessions:failed', 'Failed', failed.length, failed.map(sessionRowHtml).join(''), 'bad')}${group('sessions:other', 'Other sessions', others.length, others.map(sessionRowHtml).join(''))}`
      : `<div class="list">${list.map(sessionRowHtml).join('')}</div>`;
  const note =
    s.total > state.sessions.length
      ? `<p class="muted small">The list shows the newest ${state.sessions.length} of ${number(s.total)} sessions. The numbers above count each session.</p>`
      : '';
  return `${numbers}${bar}${note}${body}`;
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
  const role = summary?.role ?? events[0]?.role ?? 'Session';
  return `
    <h2>${esc(capital(role))}${summary?.subject ? `: ${esc(subjectWords(summary.subject))}` : ''}</h2>
    <div class="pills">${summary ? chip(summary.state, { running: 'run', done: 'ok', failed: 'bad', stopped: 'stop' }[summary.state]) : ''}${summary?.costUsd ? tag(money(summary.costUsd)) : ''}</div>
    ${summary?.subject?.startsWith('refactor:') ? `<p><button type="button" class="link" data-select="refactor:${esc(summary.subject.slice(9))}">Open the refactor</button></p>` : ''}
    <h3>Timeline</h3>
    ${items ? `<ul class="events">${items}</ul>` : '<p>Loading…</p>'}`;
}

// ---------- shell ----------

function selected(type, id) {
  return selection?.type === type && selection.id === id ? 'selected' : '';
}

function setHtml(element, html) {
  if (element.dataset.html !== html) {
    element.innerHTML = html;
    element.dataset.html = html;
  }
}

/** `#<tab>` or `#<tab>/<type>:<id>`, so a page and its detail can be linked. */
function tab() {
  const name = location.hash.slice(1).split('/')[0];
  return TABS.includes(name) ? name : 'overview';
}

async function loadSelection() {
  if (!selection) return;
  const { type, id } = selection;
  if (type === 'check') {
    const run = state.checkRuns.find((r) => r.id === id);
    const cached = fetched.get(`check:${id}`);
    if (!cached || cached.status === 'running' || run?.status === 'running') {
      const response = await fetch(`/api/checks/${id}`);
      if (response.ok) fetched.set(`check:${id}`, await response.json());
    }
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
      ? refactorDetail(refactorById(id))
      : type === 'opportunity'
        ? opportunityDetail(opportunityById(id))
        : type === 'check'
          ? checkDetail(id)
          : type === 'unit'
            ? unitDetail(id)
            : sessionDetail(id);
  panel.hidden = false;
  // The heading takes the focus when the details open.
  setHtml(
    panel,
    `<button type="button" class="close icon-button" data-close aria-label="Close the details" title="Close">×</button>${body.replace('<h2>', '<h2 tabindex="-1">')}`,
  );
}

const VIEWS = {
  overview: renderOverview,
  refactors: renderRefactors,
  scorecard: renderScorecard,
  checks: renderChecks,
  backlog: renderBacklog,
  sessions: renderSessions,
};

function render() {
  if (!state) return;
  renderTop();
  const current = tab();
  for (const link of document.querySelectorAll('.tabs a')) {
    const active = link.dataset.tab === current;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  // A refresh replaces the controls: give the focus back to the same one.
  const focused = document.activeElement;
  const key = ['select', 'filter', 'go', 'copy'].find((k) => focused?.dataset?.[k] !== undefined);
  const name = document.querySelector(`.tabs a[data-tab="${current}"]`).textContent;
  setHtml($('view'), `<h1 class="sr-only">${name}</h1>${VIEWS[current]()}`);
  renderDetail();
  if (key && !document.body.contains(focused))
    document.querySelector(`[data-${key}="${CSS.escape(focused.dataset[key])}"]`)?.focus();
}

async function refresh() {
  try {
    const response = await fetch('/api/state');
    if (!response.ok) throw new Error(String(response.status));
    state = await response.json();
    $('offline').hidden = true;
  } catch {
    $('offline').hidden = false;
    return;
  }
  await loadSelection();
  render();
}

/** The control that opened the details, to give the focus back when they close. */
let opener;

function select(type, id) {
  selection = { type, id };
  history.replaceState(null, '', `#${tab()}/${type}:${id}`);
}

function closeDetail() {
  selection = undefined;
  history.replaceState(null, '', `#${tab()}`);
  render();
  document.querySelector(`[data-select="${CSS.escape(opener ?? '')}"]`)?.focus();
}

document.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-select], [data-filter], [data-close], [data-go], [data-copy]');
  if (!target) return;
  if (target.dataset.copy !== undefined) {
    try {
      await navigator.clipboard.writeText(target.dataset.copy);
      target.textContent = 'Copied';
    } catch {
      target.textContent = 'Copy failed';
    }
    setTimeout(() => {
      target.textContent = 'Copy';
    }, 1500);
    return;
  }
  if (target.dataset.close !== undefined) return closeDetail();
  if (target.dataset.filter) {
    const [page, value] = target.dataset.filter.split(':');
    filters[page] = value;
  } else if (target.dataset.go) {
    const [page, value] = target.dataset.go.split(':');
    if (value) filters[page] = value;
    if (tab() !== page) {
      location.hash = page;
      return;
    }
  } else {
    const [type, id] = target.dataset.select.split(':');
    select(type, id);
    if (!target.closest('#detail')) opener = target.dataset.select;
    await loadSelection();
    render();
    $('detail').querySelector('h2')?.focus();
    return;
  }
  await loadSelection();
  render();
});

// A person's open or closed group stays that way after a refresh.
document.addEventListener(
  'toggle',
  (event) => {
    const id = event.target.dataset?.group;
    if (!id) return;
    if (event.target.open) closed.delete(id);
    else closed.add(id);
  },
  true,
);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && selection) closeDetail();
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
