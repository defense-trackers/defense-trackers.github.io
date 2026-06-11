// In-browser RAG search. A small LLM (MLC WebLLM, WebGPU) runs locally and
// answers questions grounded in the tracked records. Progressive enhancement:
// the web-llm library is imported from a CDN only when the user opts in, so the
// rest of the site stays zero-dependency. Falls back gracefully without WebGPU.

const $ = (id) => document.getElementById(id);
const MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'; // US-origin, open weights
let RECORDS = null;
let engine = null;

async function loadRecords() {
  if (RECORDS) return RECORDS;
  const status = await (await fetch('/data/status.json', { cache: 'no-store' })).json();
  const trackers = [...new Set(Object.values(status).map((s) => s.tracker))];
  const all = [];
  await Promise.all(trackers.map(async (t) => {
    try {
      const r = await fetch(`/data/${t}/current.json`, { cache: 'no-store' });
      if (r.ok) (await r.json()).records?.forEach((rec) => all.push({ t, f: rec.fields || {} }));
    } catch { /* skip */ }
  }));
  RECORDS = all;
  return all;
}

function prefilter(q, recs, n) {
  const terms = q.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  return recs
    .map((r) => {
      const hay = (Object.values(r.f).join(' ') + ' ' + r.t).toLowerCase();
      let s = 0;
      for (const w of terms) if (hay.includes(w)) s++;
      return { r, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, n)
    .map((x) => x.r);
}

function context(recs) {
  return recs.map((r, i) => {
    const f = r.f;
    const bits = [`[${i + 1}] tracker=${r.t}`, f.title || f.text || ''];
    if (f.amount) bits.push('$' + f.amount);
    if (f.agency) bits.push(f.agency);
    if (f.status) bits.push(f.status);
    if (f.closes) bits.push('closes ' + f.closes);
    if (f.url) bits.push(f.url);
    return bits.filter(Boolean).join(' | ');
  }).join('\n');
}

async function enable() {
  $('ai-enable').style.display = 'none';
  $('ai-progress').style.display = '';
  if (!navigator.gpu) {
    $('ai-progress').textContent = 'WebGPU is not available in this browser — try recent desktop Chrome or Edge. (The homepage keyword search works everywhere.)';
    return;
  }
  try {
    $('ai-progress').textContent = 'Loading the WebLLM runtime…';
    const webllm = await import('https://esm.run/@mlc-ai/web-llm');
    engine = await webllm.CreateMLCEngine(MODEL, {
      initProgressCallback: (p) => { $('ai-progress').textContent = p.text || 'Loading model…'; },
    });
    $('ai-progress').textContent = 'Model ready — ask a question below.';
    $('ai-box').style.display = '';
    $('ai-q').focus();
  } catch (e) {
    $('ai-progress').textContent = 'Could not load the model: ' + e.message;
  }
}

async function ask() {
  const q = $('ai-q').value.trim();
  if (!q || !engine) return;
  $('ai-answer').textContent = 'Retrieving records…';
  $('ai-cites').textContent = '';
  const recs = await loadRecords();
  const top = prefilter(q, recs, 25);
  if (!top.length) { $('ai-answer').textContent = 'No matching records found for that query.'; return; }

  const messages = [
    { role: 'system', content: 'You are a research assistant for U.S. defense-innovation data. Answer ONLY using the provided records. Be concise and specific. Cite supporting records by their [number]. If the records do not contain the answer, say so plainly.' },
    { role: 'user', content: `Question: ${q}\n\nRecords:\n${context(top)}` },
  ];

  $('ai-answer').textContent = '';
  try {
    const stream = await engine.chat.completions.create({ messages, temperature: 0.2, stream: true });
    for await (const chunk of stream) {
      $('ai-answer').textContent += chunk.choices[0]?.delta?.content || '';
    }
  } catch (e) {
    $('ai-answer').textContent = 'Error generating answer: ' + e.message;
  }

  const cites = $('ai-cites');
  cites.innerHTML = '<h3>Sources used</h3>';
  const ol = document.createElement('ol');
  top.forEach((r) => {
    const li = document.createElement('li');
    const label = r.f.title || r.f.text || '(record)';
    if (r.f.url) { const a = document.createElement('a'); a.href = r.f.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = label; li.append(a); } else li.textContent = label;
    const tag = document.createElement('span'); tag.className = 'mono dim'; tag.textContent = ' · ' + r.t;
    li.append(tag);
    ol.append(li);
  });
  cites.append(ol);
}

$('ai-enable')?.addEventListener('click', enable);
$('ai-ask')?.addEventListener('click', ask);
$('ai-q')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask(); });

(function clock() {
  const el = $('clock');
  if (!el) return;
  const t = () => { el.textContent = new Date().toISOString().slice(11, 19) + 'Z'; };
  t(); setInterval(t, 1000);
})();
