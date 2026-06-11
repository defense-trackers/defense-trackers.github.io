// Zero-dependency, zero-build renderer. The freshness signal is the whole
// point: the site must never present stale data as fresh. Badge math lives
// here; state flips live in status.json. Both are honest, or the site is broken.
//
// Public contract (do not rename — index.html / tracker.html import these):
//   loadStatus, relTime, badgeFor, badgeEl, renderIndex, renderTracker

const $ = (id) => document.getElementById(id);

export async function loadStatus() {
  const r = await fetch('/data/status.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

export function relTime(iso) {
  if (!iso) return 'never';
  const ms = Date.now() - Date.parse(iso);
  if (isNaN(ms)) return iso;
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 48) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

// fresh: within 1.25x cadence · lagging: within 3x · otherwise stale.
// Engine-reported failure states always override the age math.
export function badgeFor(s) {
  if (s.state === 'degraded' || s.state === 'quarantined') return { cls: 'bad', label: s.state };
  if (s.state === 'stale') return { cls: 'bad', label: 'stale' };
  const age = (Date.now() - Date.parse(s.last_success || 0)) / 3600000;
  const cad = s.cadence_hours || 24;
  if (!s.last_success || isNaN(age)) return { cls: 'warn', label: 'no data yet' };
  if (age <= cad * 1.25) return { cls: 'ok', label: 'fresh' };
  if (age <= cad * 3) return { cls: 'warn', label: 'lagging' };
  return { cls: 'bad', label: 'stale' };
}

export function badgeEl(s) {
  const b = badgeFor(s);
  const span = document.createElement('span');
  span.className = 'badge ' + b.cls;
  const dot = document.createElement('span');
  dot.className = 'dot' + (b.cls === 'ok' ? ' live' : '');
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = `${b.label} · ${relTime(s.last_success)}`;
  span.append(dot, text);
  return span;
}

// A tracker may have several sources; its board badge is the worst of them,
// dated to the most recent success.
function aggregate(sources) {
  const rank = { ok: 0, warn: 1, bad: 2 };
  let worst = 'ok', latest = 0;
  for (const s of sources) {
    const c = badgeFor(s).cls;
    if (rank[c] > rank[worst]) worst = c;
    const ls = Date.parse(s.last_success || 0) || 0;
    if (ls > latest) latest = ls;
  }
  const label = worst === 'ok' ? 'fresh' : worst === 'warn' ? 'lagging' : 'attention';
  return { cls: worst, label, latest };
}

function aggBadgeEl(agg) {
  const span = document.createElement('span');
  span.className = 'badge ' + agg.cls;
  const dot = document.createElement('span');
  dot.className = 'dot' + (agg.cls === 'ok' ? ' live' : '');
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  const iso = agg.latest ? new Date(agg.latest).toISOString() : '';
  text.textContent = `${agg.label} · ${relTime(iso)}`;
  span.append(dot, text);
  return span;
}

export function renderIndex(status) {
  const list = $('trackers');
  list.textContent = '';

  const groups = {};
  for (const s of Object.values(status)) {
    const t = s.tracker || 'unknown';
    (groups[t] = groups[t] || []).push(s);
  }
  const trackers = Object.keys(groups).sort();

  let fresh = 0, attn = 0, newest = 0, totalRecords = 0;
  for (const t of trackers) {
    const agg = aggregate(groups[t]);
    if (agg.cls === 'ok') fresh++; else attn++;
    for (const s of groups[t]) {
      newest = Math.max(newest, Date.parse(s.last_attempt || s.last_success || 0) || 0);
      totalRecords += s.count || 0;
    }
  }
  if ($('stat-total')) $('stat-total').textContent = trackers.length;
  if ($('stat-records')) $('stat-records').textContent = totalRecords.toLocaleString('en-US');
  if ($('stat-fresh')) $('stat-fresh').textContent = fresh;
  if ($('stat-attn'))  $('stat-attn').textContent = attn;
  if ($('last-published')) {
    const iso = newest ? new Date(newest).toISOString() : '';
    $('last-published').textContent = iso ? relTime(iso) : '—';
    $('last-published').title = iso;
  }

  if (trackers.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No trackers published yet — the first engine run creates them.';
    list.append(li);
    return;
  }

  for (const t of trackers) {
    const sources = groups[t];
    const agg = aggregate(sources);
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.state = agg.cls;

    const rail = document.createElement('span');
    rail.className = 'rail';
    rail.setAttribute('aria-hidden', 'true');

    const mainEl = document.createElement('div');
    mainEl.className = 'track-main';
    const a = document.createElement('a');
    a.className = 'track-name';
    a.href = '/' + encodeURIComponent(t) + '/';
    a.textContent = t;
    const recs = sources.reduce((n, s) => n + (s.count || 0), 0);
    const idEl = document.createElement('span');
    idEl.className = 'track-id mono dim';
    idEl.textContent = recs.toLocaleString('en-US') + ' records · ' +
      sources.length + (sources.length === 1 ? ' source' : ' sources');
    mainEl.append(a, idEl);
    const desc = TRACKER_DESC[t];
    if (desc) {
      const d = document.createElement('div');
      d.className = 'track-desc-line';
      d.textContent = desc;
      mainEl.append(d);
    }

    const statusEl = document.createElement('div');
    statusEl.className = 'track-status';
    statusEl.append(aggBadgeEl(agg));

    li.append(rail, mainEl, statusEl);
    list.append(li);
  }
}

async function fetchEvents(tracker) {
  const year = new Date().getUTCFullYear();
  const lines = [];
  for (const y of [year - 1, year]) {
    try {
      const r = await fetch(`/data/${tracker}/events/${y}.jsonl`, { cache: 'no-store' });
      if (r.ok) lines.push(...(await r.text()).trim().split('\n').filter(Boolean));
    } catch { /* a year file may not exist; fine */ }
  }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export async function renderTracker(t) {
  if (!t) { $('t-name').textContent = 'No tracker specified'; return; }
  $('t-name').textContent = t;
  document.title = t + ' — Defense Trackers';
  $('t-rss').href = '/feeds/' + encodeURIComponent(t) + '.xml';
  $('t-json').href = '/data/' + encodeURIComponent(t) + '/current.json';
  if ($('t-desc')) $('t-desc').textContent = TRACKER_DESC[t] || '';

  try {
    const status = await loadStatus();
    const mine = Object.values(status).filter((s) => s.tracker === t);
    if (mine.length) {
      $('t-badge').replaceWith(aggBadgeEl(aggregate(mine)));
      $('t-message').textContent =
        mine.length + (mine.length === 1 ? ' source' : ' sources') +
        ' · ' + mine.map((s) => s.message).filter(Boolean).join('   ·   ');
    }
  } catch { /* badge optional if status missing */ }

  const evs = (await fetchEvents(t)).reverse().slice(0, 50);
  const clt = document.querySelector('.cl-title');
  if (clt) clt.textContent = `Changelog · ${evs.length} recent`;
  const list = $('events');
  list.textContent = '';
  if (evs.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No changes recorded yet.';
    list.append(li);
  }
  for (const e of evs) {
    const li = document.createElement('li');
    li.dataset.type = e.type;
    const type = document.createElement('span');
    type.className = 'etype ' + e.type;
    type.textContent = e.type;
    const ts = document.createElement('span');
    ts.className = 'ev-ts mono dim';
    ts.textContent = (e.ts || '').slice(0, 16).replace('T', ' ') + 'Z';
    const sum = document.createElement('span');
    sum.className = 'ev-sum';
    sum.textContent = e.summary || e.key;
    li.append(type, ts, sum);
    list.append(li);
  }

  try {
    const r = await fetch(`/data/${t}/current.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const cur = await r.json();
    const recs = cur.records || [];
    $('rec-count').textContent = `(${recs.length} records, as of ${(cur.fetched_at || '').slice(0, 16).replace('T', ' ')}Z)`;
    renderReports(t, recs);
    wireFilter();
  } catch (e) {
    $('rec-count').textContent = '(records unavailable: ' + e.message + ')';
  }
}

// --- per-source report tables: each source renders as its own table whose
// columns are derived from the fields actually present, so every tracker reads
// as a tailored report without any per-tracker code. ---

const COL_PRIORITY = ['date', 'posted', 'closes', 'status', 'type', 'agency', 'amount',
  'downloads', 'likes', 'stars', 'license', 'params', 'network', 'data_ceiling', 'service',
  'sdk', 'country', 'category', 'manufacturer', 'framework_status', 'provenance', 'air_gap',
  'tags', 'description', 'note', 'as_of', 'award_id', 'repo', 'archived'];
const NAME_FIELDS = new Set(['text', 'title', 'name', 'url', 'key', 'source']);
const NUM_RE = /amount|downloads|likes|stars/i;
const ROW_CAP = 1000;

// One line per tracker so a visitor knows what they're looking at instantly.
const TRACKER_DESC = {
  pipeline: 'Open AI funding and solicitation opportunities across U.S. federal channels (grants.gov).',
  policy: 'DoD AI policy issuances and the deadlines they create.',
  authorizations: 'Which AI platforms hold which DoD / FedRAMP authorizations — and what just changed.',
  'nipr-matrix': 'Which AI tools each service can actually use on NIPR, and at what data ceiling.',
  tak: 'The TAK plugin ecosystem — what is live and what it is compatible with.',
  'blue-uas': 'DIU Blue UAS cleared platforms and NDAA-compliant components.',
  'model-ops': 'Open-weight models and the inference stacks that support them, with gov-deployability.',
  'oss-index': 'Maintained open-source software from U.S. government organizations.',
  transition: 'The largest recent DoD contract awards — the production-dollar signal (rolling 1-year window).',
  deadlines: 'Defense innovation deadlines and events, as a calendar (with iCal feed).',
  'research-funding': 'Federal AI research funding — NSF and NIH grant awards advancing artificial intelligence.',
};

function pretty(k) { return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function fmtNum(v) { const n = Number(v); return isNaN(n) ? v : n.toLocaleString('en-US'); }

function fmtVal(k, v) {
  if (/date|posted|closes|as_of|published/i.test(k) && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (NUM_RE.test(k)) return (/amount/i.test(k) ? '$' : '') + fmtNum(v);
  return v;
}

function renderReports(t, recs) {
  const box = $('records');
  box.textContent = '';
  const order = [], groups = {};
  for (const rec of recs) {
    const s = rec.source || '(unsourced)';
    if (!groups[s]) { groups[s] = []; order.push(s); }
    groups[s].push(rec);
  }
  if (order.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = 'No records yet.';
    box.append(p);
    return;
  }
  for (const src of order) {
    const rows = groups[src];
    const card = document.createElement('section');
    card.className = 'report';

    const h = document.createElement('h3');
    h.className = 'report-head';
    const label = src.startsWith(t + '-') ? src.slice(t.length + 1) : src;
    const name = document.createElement('span');
    name.className = 'report-src';
    name.textContent = label;
    const cnt = document.createElement('span');
    cnt.className = 'mono dim report-count';
    cnt.textContent = rows.length + (rows.length === 1 ? ' record' : ' records');
    h.append(name, cnt);

    const scroll = document.createElement('div');
    scroll.className = 'table-scroll';
    scroll.append(buildTable(rows.slice(0, ROW_CAP)));

    card.append(h, scroll);
    if (rows.length > ROW_CAP) {
      const more = document.createElement('p');
      more.className = 'mono dim report-more';
      more.textContent = `showing ${ROW_CAP} of ${rows.length} — full set in current.json`;
      card.append(more);
    }
    box.append(card);
  }
}

function buildTable(rows) {
  const keys = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r.fields || {})) {
      if (!NAME_FIELDS.has(k)) keys.add(k);
    }
  }
  const sorted = [...keys].sort((a, b) => {
    const ia = COL_PRIORITY.indexOf(a), ib = COL_PRIORITY.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
  const labelOf = (r) => { const f = r.fields || {}; return f.title || f.name || f.text || r.key; };
  // drop any column that just repeats the name (e.g. a curated key field)
  const cols = sorted.filter((c) => !rows.every((r) => ((r.fields || {})[c] || '') === labelOf(r)));

  const table = document.createElement('table');
  table.className = 'report-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = 'name';
  htr.append(th0);
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = pretty(c);
    if (NUM_RE.test(c)) th.className = 'num';
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const f = r.fields || {};
    const tr = document.createElement('tr');
    const td0 = document.createElement('td');
    td0.className = 'col-name';
    const label = f.title || f.name || f.text || r.key;
    if (f.url) {
      const a = document.createElement('a');
      a.href = f.url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = label;
      td0.append(a);
    } else {
      td0.textContent = label;
    }
    tr.append(td0);
    for (const c of cols) {
      const td = document.createElement('td');
      let v = f[c];
      if (c === 'tags' && v) v = v.split(',').map((s) => s.trim()).slice(0, 6).join(', ');
      let out = (v !== undefined && v !== '') ? fmtVal(c, v) : '—';
      if (out.length > 160) out = out.slice(0, 158) + '…';
      td.textContent = out;
      if (NUM_RE.test(c)) td.className = 'num';
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  makeSortable(table);
  return table;
}

// Click a column header to sort that source's table (numeric columns sort
// numerically). Toggles asc/desc.
function makeSortable(table) {
  const ths = [...table.querySelectorAll('thead th')];
  ths.forEach((th, idx) => {
    th.addEventListener('click', () => {
      const numeric = th.classList.contains('num');
      const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
      ths.forEach((h) => { delete h.dataset.dir; const a = h.querySelector('.sort-arrow'); if (a) a.remove(); });
      th.dataset.dir = dir;
      const tbody = table.querySelector('tbody');
      const rows = [...tbody.querySelectorAll('tr')];
      rows.sort((a, b) => {
        let av = a.children[idx] ? a.children[idx].textContent : '';
        let bv = b.children[idx] ? b.children[idx].textContent : '';
        if (numeric) {
          av = parseFloat(av.replace(/[^0-9.-]/g, '')) || 0;
          bv = parseFloat(bv.replace(/[^0-9.-]/g, '')) || 0;
          return dir === 'asc' ? av - bv : bv - av;
        }
        return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
      rows.forEach((r) => tbody.appendChild(r));
      const arrow = document.createElement('span');
      arrow.className = 'sort-arrow';
      arrow.textContent = dir === 'asc' ? ' ▲' : ' ▼';
      th.appendChild(arrow);
    });
  });
}

// Live filter across every source table on the page.
function wireFilter() {
  const box = document.getElementById('filter');
  if (!box) return;
  box.addEventListener('input', () => {
    const q = box.value.trim().toLowerCase();
    document.querySelectorAll('#records .report').forEach((card) => {
      let shown = 0;
      card.querySelectorAll('tbody tr').forEach((tr) => {
        const match = !q || tr.textContent.toLowerCase().includes(q);
        tr.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      card.style.display = (q && shown === 0) ? 'none' : '';
    });
  });
}

// Live UTC clock in the system bar — cosmetic, reinforces the "honest about
// time" posture. Runs on import; no-op if there's no clock element.
(function clock() {
  const el = document.getElementById('clock');
  if (!el) return;
  const tick = () => { el.textContent = new Date().toISOString().slice(11, 19) + 'Z'; };
  tick();
  setInterval(tick, 1000);
})();
