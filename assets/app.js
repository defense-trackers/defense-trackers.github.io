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
  wireGlobalSearch(status);
  renderClosingSoon();
  renderSparkline();
}

async function fetchEvents(tracker) {
  const year = new Date().getUTCFullYear();
  const get = async (y) => {
    try {
      const r = await fetch(`/data/${tracker}/events/${y}.jsonl`, { cache: 'no-store' });
      if (r.ok) return (await r.text()).trim().split('\n').filter(Boolean);
    } catch { /* ignore */ }
    return [];
  };
  // Fetch the current year; only reach back to last year when this year is
  // empty, so a brand-new year doesn't 404 on every page load.
  let lines = await get(year);
  if (lines.length === 0) lines = await get(year - 1);
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
      const freshest = mine.map((s) => Date.parse(s.last_success || 0) || 0)
        .reduce((a, b) => Math.max(a, b), 0);
      $('t-message').textContent =
        mine.length + (mine.length === 1 ? ' source' : ' sources') +
        (freshest ? ' · updated ' + relTime(new Date(freshest).toISOString()) : '');
    }
    renderAbout(t, status);
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
    renderStatStrip(recs);
    renderReports(t, recs);
    wireFilter();
    // whole-row click opens the record's source (links inside still work)
    $('records').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const tr = e.target.closest('tr[data-href]');
      if (tr) window.open(tr.dataset.href, '_blank', 'noopener');
    });
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
  pipeline: 'Bid-able DoD / defense-tech opportunities tuned to on-prem AI, mesh assurance, edge autonomy & contested logistics. Live SAM.gov contract solicitations (AI, autonomous, unmanned, mesh — DoD-filtered) plus grants.gov R&D awards. Each row links to its SAM/grants source.',
  policy: 'DoD AI policy issuances and the deadlines they create.',
  authorizations: 'FedRAMP cloud authorizations (last ~4 years) — the IL-deployable platforms a defense AI builder can buy onto, and what just changed.',
  'nipr-matrix': 'Which AI tools each service can actually use on NIPR, and at what data ceiling.',
  tak: 'The TAK plugin ecosystem — what is live and what it is compatible with.',
  'blue-uas': 'DIU Blue UAS cleared platforms and NDAA-compliant components.',
  'model-ops': 'Open-weight models and the inference stacks that support them, with gov-deployability.',
  'oss-index': 'Active, defense-relevant open-source from U.S. government orgs — repos matching AI / autonomy / mesh / sensing / cyber keywords, pushed within the last year.',
  transition: 'The largest recent DoD contract awards — the production-dollar signal (rolling 1-year window).',
  deadlines: 'Defense innovation deadlines and events, as a calendar (with iCal feed).',
  'research-funding': 'Federal AI research funding — NSF and NIH grant awards advancing artificial intelligence.',
  'ai-spending': 'Who is winning DoD AI dollars — top recipients and recent AI contract awards.',
  programs: 'Your bid map — funding vehicles, program offices, OTAs & compliance enablers for on-prem AI, mesh assurance, edge autonomy & contested logistics.',
};

function pretty(k) { return k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

function fmtNum(v) { const n = Number(v); return isNaN(n) ? v : n.toLocaleString('en-US'); }

function fmtVal(k, v) {
  if (/date|posted|closes|as_of|published/i.test(k) && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  if (NUM_RE.test(k)) return (/amount/i.test(k) ? '$' : '') + fmtNum(v);
  return v;
}

function abbrNum(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(1) + 'T';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(Math.round(n));
}

function downloadCSV(table, filename) {
  const lines = [];
  table.querySelectorAll('tr').forEach((tr) => {
    const cells = [...tr.children].map((td) => {
      let s = td.textContent.replace(/\s+/g, ' ').trim();
      if (/[",\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    });
    lines.push(cells.join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
}

// parse YYYY-MM-DD or MM/DD/YYYY to epoch ms (NaN if unparseable)
function pd(s) {
  if (!s) return NaN;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return Date.parse(String(s).slice(0, 10));
  const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return Date.parse(`${m[3]}-${m[1]}-${m[2]}`);
  return Date.parse(s);
}

// key-stat strip atop a tracker's data: records, sources, total $, closing soon
function renderStatStrip(recs) {
  const el = document.getElementById('statstrip');
  if (!el) return;
  el.textContent = '';
  const chip = (label, val, cls) => {
    const s = document.createElement('span');
    s.className = 'stat-chip' + (cls ? ' ' + cls : '');
    const b = document.createElement('b'); b.textContent = val;
    const l = document.createElement('span'); l.className = 'dim'; l.textContent = ' ' + label;
    s.append(b, l); el.append(s);
  };
  const sources = new Set(recs.map((r) => r.source)).size;
  chip(recs.length === 1 ? 'record' : 'records', recs.length.toLocaleString('en-US'));
  chip(sources === 1 ? 'source' : 'sources', String(sources));
  let sum = 0, hasAmt = false;
  for (const r of recs) {
    const f = r.fields || {};
    const k = Object.keys(f).find((x) => /amount/i.test(x));
    if (k) { const v = parseFloat(String(f[k]).replace(/[^0-9.-]/g, '')); if (!isNaN(v)) { sum += v; hasAmt = true; } }
  }
  if (hasAmt) chip('total $', '$' + abbrNum(sum));
  const now = Date.now();
  let soon = 0;
  for (const r of recs) { const t = pd((r.fields || {}).closes); if (!isNaN(t) && t >= now && t <= now + 30 * 864e5) soon++; }
  if (soon) chip('closing ≤30d', String(soon), 'warn');
}

// cross-tracker search (homepage): lazy-load every tracker's records once
let ALL_RECORDS = null;
async function loadAllRecords(status) {
  if (ALL_RECORDS) return ALL_RECORDS;
  const trackers = [...new Set(Object.values(status).map((s) => s.tracker))];
  const all = [];
  await Promise.all(trackers.map(async (t) => {
    try {
      const r = await fetch(`/data/${t}/current.json`, { cache: 'no-store' });
      if (r.ok) { const c = await r.json(); (c.records || []).forEach((rec) => all.push({ t, f: rec.fields || {}, key: rec.key })); }
    } catch { /* skip */ }
  }));
  ALL_RECORDS = all;
  return all;
}

function renderGlobalResults(el, hits, q) {
  el.textContent = '';
  const head = document.createElement('p');
  head.className = 'mono dim gres-head';
  head.textContent = hits.length ? `${hits.length}${hits.length === 120 ? '+' : ''} matches for "${q}"` : `No matches for "${q}".`;
  el.append(head);
  const byT = {};
  hits.forEach((h) => { (byT[h.t] = byT[h.t] || []).push(h); });
  Object.keys(byT).sort().forEach((t) => {
    const sec = document.createElement('div');
    sec.className = 'gres-group';
    const a = document.createElement('a');
    a.className = 'gres-tracker';
    a.href = '/' + encodeURIComponent(t) + '/?q=' + encodeURIComponent(q);
    a.textContent = `${t} (${byT[t].length})`;
    sec.append(a);
    byT[t].slice(0, 6).forEach((h) => {
      const row = document.createElement('div');
      row.className = 'gres-row';
      const label = h.f.title || h.f.text || h.key;
      if (h.f.url) { const la = document.createElement('a'); la.href = h.f.url; la.target = '_blank'; la.rel = 'noopener'; la.textContent = label; row.append(la); } else row.textContent = label;
      sec.append(row);
    });
    el.append(sec);
  });
}

function wireGlobalSearch(status) {
  const gs = document.getElementById('gsearch');
  const gr = document.getElementById('gresults');
  const board = document.getElementById('board-section');
  const soon = document.getElementById('closing-soon');
  if (!gs || !gr) return;
  const setContext = (visible) => {
    if (board) board.style.display = visible ? '' : 'none';
    // only restore the closing-soon panel if it actually had content
    if (soon) soon.style.display = (visible && soon.dataset.populated === '1') ? '' : 'none';
  };
  gs.addEventListener('input', async () => {
    const q = gs.value.trim().toLowerCase();
    if (q.length < 2) { gr.style.display = 'none'; gr.textContent = ''; setContext(true); return; }
    const all = await loadAllRecords(status);
    const hits = all.filter((x) =>
      (x.key || '').toLowerCase().includes(q) ||
      Object.values(x.f).some((v) => String(v).toLowerCase().includes(q))
    ).slice(0, 120);
    setContext(false);
    gr.style.display = '';
    renderGlobalResults(gr, hits, gs.value.trim());
  });
}

// homepage: solicitations & events closing in the next 30 days, soonest first
async function renderClosingSoon() {
  const el = document.getElementById('closing-soon');
  if (!el) return;
  let recs = [];
  try { const r = await fetch('/data/deadlines/current.json', { cache: 'no-store' }); if (r.ok) recs = (await r.json()).records || []; } catch { return; }
  const now = Date.now();
  const soon = recs
    .map((rc) => ({ f: rc.fields || {}, t: pd((rc.fields || {}).date || (rc.fields || {}).closes) }))
    .filter((x) => !isNaN(x.t) && x.t >= now && x.t <= now + 30 * 864e5)
    .sort((a, b) => a.t - b.t)
    .slice(0, 12);
  if (!soon.length) { el.dataset.populated = '0'; return; }
  el.dataset.populated = '1';
  el.style.display = '';
  el.textContent = '';
  const h = document.createElement('h2'); h.textContent = 'Closing in the next 30 days'; el.append(h);
  const ul = document.createElement('ul'); ul.className = 'soon-list';
  for (const x of soon) {
    const li = document.createElement('li');
    const days = Math.ceil((x.t - now) / 864e5);
    const d = document.createElement('span'); d.className = 'soon-date mono';
    d.textContent = (x.f.date || x.f.closes || '').slice(0, 10) + ' · ' + (days === 0 ? 'today' : days + 'd');
    const tt = document.createElement('span'); tt.className = 'soon-title';
    const label = x.f.title || x.f.text || '';
    if (x.f.url) { const a = document.createElement('a'); a.href = x.f.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label; tt.append(a); } else tt.textContent = label;
    li.append(d, tt);
    if (x.f.from) { const fr = document.createElement('span'); fr.className = 'mono dim'; fr.textContent = x.f.from; li.append(fr); }
    ul.append(li);
  }
  el.append(ul);
}

// homepage: data-points-over-time sparkline from the appended metrics history
async function renderSparkline() {
  const el = document.getElementById('sparkline');
  if (!el) return;
  let pts = [];
  try { const r = await fetch('/data/metrics.jsonl', { cache: 'no-store' }); if (r.ok) pts = (await r.text()).trim().split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return; }
  if (pts.length < 2) return;
  pts = pts.slice(-40);
  const vals = pts.map((p) => p.total || 0);
  const max = Math.max(...vals), min = Math.min(...vals);
  const w = 180, h = 34, n = vals.length;
  const norm = (v) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
  const step = n > 1 ? w / (n - 1) : 0;
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${norm(v).toFixed(1)}`).join(' ');
  el.innerHTML = `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-label="data points over time"><path class="spark-path" d="${d}" fill="none" stroke-width="1.5"/></svg><span class="spark-label mono dim">data points · last ${n} runs</span>`;
}

// tracker page: which sources feed it, their state, and cadence
function renderAbout(t, status) {
  const el = document.getElementById('about-body');
  if (!el) return;
  el.textContent = '';
  const sources = Object.entries(status).filter(([, s]) => s.tracker === t).sort();
  const ul = document.createElement('ul');
  ul.className = 'about-sources';
  for (const [id, s] of sources) {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.className = 'mono'; name.textContent = id;
    const meta = document.createElement('span'); meta.className = 'dim';
    meta.textContent = ` — ${s.state}, ${s.count || 0} records, every ${s.cadence_hours || 24}h`;
    li.append(name, meta);
    ul.append(li);
  }
  el.append(ul);
  const note = document.createElement('p');
  note.className = 'dim';
  note.innerHTML = 'Public sources only; append-only and hash-chained. See the <a href="/methodology.html">methodology</a> for what is deliberately excluded.';
  el.append(note);
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
  // Multi-source trackers get a tab switcher so the page shows one clean table
  // at a time instead of a wall of stacked cards.
  const tabbar = order.length > 1 ? document.createElement('div') : null;
  if (tabbar) tabbar.className = 'tabbar';
  const cards = [];

  order.forEach((src, idx) => {
    const rows = groups[src];
    const card = document.createElement('section');
    card.className = 'report' + (tabbar && idx > 0 ? ' hidden' : '');
    const label = src.startsWith(t + '-') ? src.slice(t.length + 1) : src;

    const table = buildTable(rows.slice(0, ROW_CAP));

    const h = document.createElement('h3');
    h.className = 'report-head';
    const name = document.createElement('span'); name.className = 'report-src'; name.textContent = label; h.append(name);

    const amtKey = Object.keys((rows[0] || {}).fields || {}).find((k) => /amount/i.test(k));
    if (amtKey) {
      let sum = 0;
      for (const r of rows) { const v = parseFloat(String(r.fields[amtKey] || '').replace(/[^0-9.-]/g, '')); if (!isNaN(v)) sum += v; }
      if (sum > 0) { const tot = document.createElement('span'); tot.className = 'report-total'; tot.textContent = 'Σ $' + abbrNum(sum); h.append(tot); }
    }
    const cnt = document.createElement('span'); cnt.className = 'mono dim report-count'; cnt.textContent = rows.length + (rows.length === 1 ? ' record' : ' records'); h.append(cnt);
    const csv = document.createElement('button'); csv.type = 'button'; csv.className = 'csv-btn'; csv.textContent = 'CSV'; csv.title = 'Download this table as CSV'; csv.addEventListener('click', () => downloadCSV(table, `${t}-${label}.csv`)); h.append(csv);

    card.append(h);
    if (amtKey) { const chart = buildChart(rows, amtKey); if (chart) card.append(chart); } // summary chart, then detail table
    const scroll = document.createElement('div'); scroll.className = 'table-scroll'; scroll.append(table); card.append(scroll);
    if (rows.length > ROW_CAP) {
      const more = document.createElement('p'); more.className = 'mono dim report-more';
      more.textContent = `showing ${ROW_CAP} of ${rows.length} — full set in current.json`; card.append(more);
    }
    cards.push(card);

    if (tabbar) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'tab' + (idx === 0 ? ' active' : '');
      b.textContent = `${label} · ${rows.length}`;
      b.addEventListener('click', () => {
        tabbar.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        cards.forEach((c, i) => c.classList.toggle('hidden', i !== idx));
      });
      tabbar.append(b);
    }
  });

  if (tabbar) box.append(tabbar);
  cards.forEach((c) => box.append(c));
}

// horizontal bar chart of the top values in an amount column (summary view)
function buildChart(rows, amtKey) {
  const data = rows
    .map((r) => ({ label: r.fields.title || r.fields.text || '', v: parseFloat(String(r.fields[amtKey] || '').replace(/[^0-9.-]/g, '')) || 0, url: r.fields.url }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v)
    .slice(0, 10);
  if (data.length < 2) return null;
  const max = data[0].v;
  const wrap = document.createElement('div');
  wrap.className = 'barchart';
  for (const d of data) {
    const row = document.createElement('div'); row.className = 'bc-row';
    const lab = document.createElement('span'); lab.className = 'bc-label'; lab.title = d.label;
    if (d.url) { const a = document.createElement('a'); a.href = d.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = d.label; lab.append(a); } else lab.textContent = d.label;
    const track = document.createElement('span'); track.className = 'bc-track';
    const bar = document.createElement('span'); bar.className = 'bc-bar'; bar.style.width = Math.max(2, (d.v / max) * 100) + '%'; track.append(bar);
    const val = document.createElement('span'); val.className = 'bc-val mono'; val.textContent = '$' + abbrNum(d.v);
    row.append(lab, track, val);
    wrap.append(row);
  }
  return wrap;
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

  // per-column max for the inline magnitude bars on numeric columns
  const maxByCol = {};
  for (const c of cols) {
    if (!NUM_RE.test(c)) continue;
    let m = 0;
    for (const r of rows) {
      const v = parseFloat(String((r.fields || {})[c] || '').replace(/[^0-9.-]/g, ''));
      if (!isNaN(v) && v > m) m = v;
    }
    maxByCol[c] = m;
  }

  const table = document.createElement('table');
  table.className = 'report-table';
  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  const th0 = document.createElement('th');
  th0.textContent = 'name';
  th0.tabIndex = 0; th0.setAttribute('role', 'button'); th0.setAttribute('aria-sort', 'none');
  htr.append(th0);
  for (const c of cols) {
    const th = document.createElement('th');
    th.textContent = pretty(c);
    if (NUM_RE.test(c)) th.className = 'num';
    if (/^(date|posted|closes|deadline|updated|as_of)$/i.test(c)) th.dataset.type = 'date';
    th.tabIndex = 0; th.setAttribute('role', 'button'); th.setAttribute('aria-sort', 'none');
    htr.append(th);
  }
  thead.append(htr);
  table.append(thead);

  const tbody = document.createElement('tbody');
  for (const r of rows) {
    const f = r.fields || {};
    const tr = document.createElement('tr');
    if (f.url) { tr.dataset.href = f.url; tr.classList.add('rowlink'); }
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
    // closing-soon / past highlighting from a "closes" field, falling back to a
    // date embedded in a status string (curated trackers like programs put the
    // deadline in text, e.g. "OPEN — closes 2026-06-15").
    let tms = pd(f.closes);
    if (isNaN(tms) && f.status) { const m = String(f.status).match(/\d{4}-\d{2}-\d{2}/); if (m) tms = pd(m[0]); }
    if (!isNaN(tms)) {
      const days = Math.ceil((tms - Date.now()) / 864e5);
      if (days >= 0 && days <= 30) {
        tr.classList.add('row-soon');
        const tag = document.createElement('span');
        tag.className = 'soon-tag';
        tag.textContent = days === 0 ? ' today' : ` ${days}d`;
        td0.appendChild(tag);
      } else if (days < 0) {
        tr.classList.add('row-past');
      }
    }
    tr.append(td0);
    for (const c of cols) {
      const td = document.createElement('td');
      let v = f[c];
      if (c === 'tags' && v) v = v.split(',').map((s) => s.trim()).slice(0, 6).join(', ');
      let out = (v !== undefined && v !== '') ? fmtVal(c, v) : '—';
      if (out.length > 160) out = out.slice(0, 158) + '…';
      td.textContent = out;
      if (NUM_RE.test(c)) {
        td.className = 'num';
        const v = parseFloat(out.replace(/[^0-9.-]/g, ''));
        const m = maxByCol[c];
        if (m > 0 && !isNaN(v) && v > 0) {
          const pct = Math.max(3, Math.round((v / m) * 100));
          td.style.background = `linear-gradient(to left, color-mix(in oklab, var(--brand) 20%, transparent) ${pct}%, transparent ${pct}%)`;
        }
      }
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
  const sortBy = (th, idx) => {
    const numeric = th.classList.contains('num');
    const isDate = th.dataset.type === 'date';
    const dir = th.dataset.dir === 'asc' ? 'desc' : 'asc';
    ths.forEach((h) => { delete h.dataset.dir; h.setAttribute('aria-sort', 'none'); const a = h.querySelector('.sort-arrow'); if (a) a.remove(); });
    th.dataset.dir = dir;
    th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
    const tbody = table.querySelector('tbody');
    const rows = [...tbody.querySelectorAll('tr')];
    rows.sort((a, b) => {
      let av = a.children[idx] ? a.children[idx].textContent : '';
      let bv = b.children[idx] ? b.children[idx].textContent : '';
      if (isDate) {
        // real chronological order via the shared date parser; undated rows last
        const at = pd(av), bt = pd(bv);
        const an = isNaN(at) ? Infinity : at;
        const bn = isNaN(bt) ? Infinity : bt;
        return dir === 'asc' ? an - bn : bn - an;
      }
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
  };
  ths.forEach((th, idx) => {
    th.addEventListener('click', () => sortBy(th, idx));
    th.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(th, idx); }
    });
  });
}

// Live filter across every source table on the page.
function wireFilter() {
  const box = document.getElementById('filter');
  if (!box) return;
  const apply = () => {
    const q = box.value.trim().toLowerCase();
    document.querySelectorAll('#records .report').forEach((card) => {
      let shown = 0;
      card.querySelectorAll('tbody tr').forEach((tr) => {
        const match = !q || tr.textContent.toLowerCase().includes(q);
        tr.style.display = match ? '' : 'none';
        if (match) shown++;
      });
      // While filtering, span every source: force matching cards visible with an
      // explicit `block` that overrides the tab system's `.hidden` class (the two
      // used to fight, blanking the screen when matches were in an inactive tab).
      // Clearing the filter restores inline display so tab visibility takes over.
      if (q) card.style.display = shown > 0 ? 'block' : 'none';
      else card.style.display = '';
    });
    const u = new URL(location.href);
    if (q) u.searchParams.set('q', box.value.trim()); else u.searchParams.delete('q');
    history.replaceState(null, '', u);
  };
  box.addEventListener('input', apply);
  const initial = new URLSearchParams(location.search).get('q'); // shareable filtered views
  if (initial) { box.value = initial; apply(); }
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
