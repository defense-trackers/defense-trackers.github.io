// Zero-dependency, zero-build renderer. The freshness signal is the whole
// point: the site must never present stale data as fresh. Badge math lives
// here; state flips live in status.json. Both are honest, or the site is broken.
//
// Public contract (do not rename — index.html / tracker.html import these):
//   loadStatus, relTime, badgeFor, badgeEl, renderIndex, renderTracker

const $ = (id) => document.getElementById(id);

export async function loadStatus() {
  const r = await fetch('data/status.json', { cache: 'no-store' });
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

export function renderIndex(status) {
  const list = $('trackers');
  list.textContent = '';
  const entries = Object.entries(status).sort(([a], [b]) => a.localeCompare(b));

  let fresh = 0, attn = 0, newest = 0;
  for (const [, s] of entries) {
    const cls = badgeFor(s).cls;
    if (cls === 'ok') fresh++; else attn++;
    newest = Math.max(newest, Date.parse(s.last_attempt || s.last_success || 0) || 0);
  }
  if ($('stat-total')) $('stat-total').textContent = entries.length;
  if ($('stat-fresh')) $('stat-fresh').textContent = fresh;
  if ($('stat-attn'))  $('stat-attn').textContent = attn;
  if ($('last-published')) {
    const iso = newest ? new Date(newest).toISOString() : '';
    $('last-published').textContent = iso ? relTime(iso) : '—';
    $('last-published').title = iso;
  }

  if (entries.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No sources published yet — the first engine run creates them.';
    list.append(li);
    return;
  }

  for (const [id, s] of entries) {
    const b = badgeFor(s);
    const li = document.createElement('li');
    li.className = 'track';
    li.dataset.state = b.cls;

    const rail = document.createElement('span');
    rail.className = 'rail';
    rail.setAttribute('aria-hidden', 'true');

    const mainEl = document.createElement('div');
    mainEl.className = 'track-main';
    const a = document.createElement('a');
    a.className = 'track-name';
    a.href = 'tracker.html?t=' + encodeURIComponent(s.tracker);
    a.textContent = s.tracker;
    const idEl = document.createElement('span');
    idEl.className = 'track-id mono dim';
    idEl.textContent = id;
    mainEl.append(a, idEl);
    if (s.message) {
      const msg = document.createElement('div');
      msg.className = 'track-msg mono';
      msg.textContent = s.message;
      mainEl.append(msg);
    }

    const statusEl = document.createElement('div');
    statusEl.className = 'track-status';
    statusEl.append(badgeEl(s));

    li.append(rail, mainEl, statusEl);
    list.append(li);
  }
}

async function fetchEvents(tracker) {
  const year = new Date().getUTCFullYear();
  const lines = [];
  for (const y of [year - 1, year]) {
    try {
      const r = await fetch(`data/${tracker}/events/${y}.jsonl`, { cache: 'no-store' });
      if (r.ok) lines.push(...(await r.text()).trim().split('\n').filter(Boolean));
    } catch { /* a year file may not exist; fine */ }
  }
  return lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export async function renderTracker(t) {
  if (!t) { $('t-name').textContent = 'No tracker specified'; return; }
  $('t-name').textContent = t;
  document.title = t + ' — Defense Trackers';
  $('t-rss').href = 'feeds/' + encodeURIComponent(t) + '.xml';
  $('t-json').href = 'data/' + encodeURIComponent(t) + '/current.json';

  try {
    const status = await loadStatus();
    const mine = Object.values(status).find((s) => s.tracker === t);
    if (mine) {
      $('t-badge').replaceWith(badgeEl(mine));
      if (mine.message) $('t-message').textContent = mine.message;
    }
  } catch { /* badge optional if status missing */ }

  const evs = (await fetchEvents(t)).reverse().slice(0, 200);
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
    const r = await fetch(`data/${t}/current.json`, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const cur = await r.json();
    const recs = cur.records || [];
    $('rec-count').textContent = `(${recs.length}, as of ${(cur.fetched_at || '').slice(0, 16).replace('T', ' ')}Z)`;
    const tbody = $('records').querySelector('tbody');
    for (const rec of recs.slice(0, 500)) {
      const tr = document.createElement('tr');
      const key = document.createElement('td');
      key.className = 'mono dim';
      key.textContent = rec.key;
      const val = document.createElement('td');
      val.textContent = rec.fields ? (rec.fields.text || JSON.stringify(rec.fields)) : '';
      tr.append(key, val);
      tbody.append(tr);
    }
  } catch (e) {
    $('rec-count').textContent = '(records unavailable: ' + e.message + ')';
  }
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
