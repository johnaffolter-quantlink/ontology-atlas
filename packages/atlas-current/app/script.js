(() => {
'use strict';
const D = JSON.parse(document.getElementById('atlas-data').textContent);
const FC = (() => { try { return JSON.parse(document.getElementById('atlas-forecast')?.textContent || 'null'); } catch { return null; } })();
let showForecast = true;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { domain: 'Domain', capability: 'Capability', element: 'Element' };
const lerp = (a, b, t) => a + (b - a) * t;
const ease = u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

// ---------------------------------------------------------------- graph model
const nodes = D.nodes.map(n => ({ ...n, en: 0, touch: 0 }));
const byId = new Map(nodes.map(n => [n.s, n]));
const edges = D.edges.map((e, i) => ({ ...e, i, A: byId.get(e.a), B: byId.get(e.b), en: 0 }));
const incident = new Map(nodes.map(n => [n, []]));
for (const e of edges) { incident.get(e.A).push(e); incident.get(e.B).push(e); }
const contents = n => incident.get(n).filter(e => e.y === 'c' && e.A === n).map(e => e.B);
const containers = n => incident.get(n).filter(e => e.y === 'c' && e.B === n).map(e => e.A);
const dependsOn = n => incident.get(n).filter(e => e.y === 'd' && e.A === n).map(e => e.B);
const domainOf = n => n.k === 'domain' ? n : (containers(n).find(c => c.k === 'domain') || containers(n).map(domainOf).find(Boolean) || null);
const hashOf = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

/**
 * Impact reach, the same rule the signal kernel propagates: a change reaches everything that
 * depends on it, and everything it contains. Breadth-first, so `hop` is the shortest hop count
 * and `via` is the edge the change first arrived along.
 */
function reach(src) {
  const hop = new Map([[src, 0]]), via = new Map(), order = [src];
  for (let i = 0; i < order.length; i++) {
    const n = order[i], h = hop.get(n);
    for (const e of incident.get(n)) {
      const next = e.y === 'd' && e.B === n ? e.A : e.y === 'c' && e.A === n ? e.B : null;
      if (!next || hop.has(next)) continue;
      hop.set(next, h + 1); via.set(next, e); order.push(next);
    }
  }
  return { hop, via, order, max: Math.max(...hop.values()) };
}

// Kinds of work, read from each commit's conventional prefix.
const WORK = {
  build: { label: 'Build', col: '#fafafa', rgb: '250,250,250' },
  repair: { label: 'Repair', col: '#bdbdbd', rgb: '189,189,189' },
  plan: { label: 'Plan', col: '#8f8f8f', rgb: '143,143,143' },
  tend: { label: 'Tend', col: '#5e5e5e', rgb: '110,110,110' },
};
const workOf = c => { const t = (c.s.match(/^(\w+)/) || [])[1]; return t === 'feat' ? 'build' : t === 'fix' ? 'repair' : t === 'docs' ? 'plan' : 'tend'; };
const commits = D.commits.map(c => ({ ...c, w: workOf(c), t: +new Date(c.d), nodes: c.n.map(s => byId.get(s)).filter(Boolean) }));

// Parse a vault page body into its standfirst and sections.
function parseBody(body) {
  const out = { desc: '', sections: [] };
  let cur = null, para = [];
  const flush = () => { if (para.length) { (cur ? cur.blocks : (out.pre ??= [])).push({ p: para.join(' ') }); para = []; } };
  for (const raw of body.split('\n')) {
    const line = raw.trimEnd();
    if (/^#{2,3}\s/.test(line)) { flush(); cur = { h: line.replace(/^#+\s*/, ''), blocks: [] }; out.sections.push(cur); continue; }
    if (/^\s*[-*]\s+/.test(line)) { flush(); const b = cur ? cur.blocks : (out.pre ??= []); const last = b[b.length - 1]; const item = line.replace(/^\s*[-*]\s+/, ''); if (last && last.ul) last.ul.push(item); else b.push({ ul: [item] }); continue; }
    if (!line.trim()) { flush(); continue; }
    if (/^#\s/.test(line)) continue;
    para.push(line.trim());
  }
  flush();
  const pre = out.pre || [];
  const first = pre.findIndex(b => b.p);
  if (first >= 0) { out.desc = pre[first].p; pre.splice(first, 1); }
  out.rest = pre;
  return out;
}
const inline = s => esc(s).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const firstSentence = s => { const m = String(s).match(/^.*?[.!?](\s|$)/); return (m ? m[0] : s).trim(); };
for (const n of nodes) n.doc = parseBody(n.body || '');

// ---------------------------------------------------------------- geometry: polylines
const NPTS = 32;
function resample(pts, N = NPTS) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const total = cum[cum.length - 1] || 1, out = [];
  for (let k = 0, j = 0; k < N; k++) {
    const d = (k / (N - 1)) * total;
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const span = cum[j + 1] - cum[j] || 1, u = Math.min(1, Math.max(0, (d - cum[j]) / span));
    out.push({ x: lerp(pts[j].x, pts[j + 1].x, u), y: lerp(pts[j].y, pts[j + 1].y, u) });
  }
  return out;
}
/** Evenly resampled, so a fraction of the index is a fraction of the length. */
function pointOn(pts, s) {
  const f = Math.max(0, Math.min(1, s)) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(f)), u = f - i;
  return { x: lerp(pts[i].x, pts[i + 1].x, u), y: lerp(pts[i].y, pts[i + 1].y, u) };
}
function curvePts(a, b, bend) {
  const c = { x: (a.x + b.x) / 2 - (b.y - a.y) * bend, y: (a.y + b.y) / 2 + (b.x - a.x) * bend }, out = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40, u = 1 - t; out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }); }
  return resample(out);
}
/** Orthogonal route through `corners`, each corner rounded like a drafted connector. */
function orthoPts(corners, r = 12) {
  const out = [corners[0]];
  for (let i = 1; i < corners.length - 1; i++) {
    const p = corners[i - 1], c = corners[i], q = corners[i + 1];
    const l1 = Math.hypot(c.x - p.x, c.y - p.y), l2 = Math.hypot(q.x - c.x, q.y - c.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    if (rr < 0.5) { out.push(c); continue; }
    const a = { x: c.x - ((c.x - p.x) / l1) * rr, y: c.y - ((c.y - p.y) / l1) * rr };
    const b = { x: c.x + ((q.x - c.x) / l2) * rr, y: c.y + ((q.y - c.y) / l2) * rr };
    for (let k = 0; k <= 5; k++) { const t = k / 5, u = 1 - t; out.push({ x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y }); }
  }
  out.push(corners[corners.length - 1]);
  return resample(out);
}

// ---------------------------------------------------------------- layout A: the map (force)
const domains = nodes.filter(n => n.k === 'domain');
const anchor = new Map();
domains.forEach((d, i) => { const a = -Math.PI / 2 + (i / domains.length) * Math.PI * 2 + Math.PI / 4; anchor.set(d, { x: Math.cos(a) * 360, y: Math.sin(a) * 300 }); });
const anchorOf = n => anchor.get(domainOf(n)) || { x: 0, y: 0 };
const R = n => n.k === 'domain' ? 11 : n.k === 'capability' ? 5 + Math.min(4, Math.sqrt(contents(n).length) * 1.4) : 3;
d3.forceSimulation(nodes)
  .force('link', d3.forceLink(edges.map(e => ({ source: e.A, target: e.B, y: e.y }))).distance(l => l.y === 'c' ? (l.source.k === 'domain' ? (l.target.k === 'capability' ? 110 : 150) : 34) : 120).strength(l => l.y === 'c' ? (l.source.k === 'domain' ? 0.25 : 0.8) : 0.05))
  .force('charge', d3.forceManyBody().strength(n => n.k === 'domain' ? -900 : n.k === 'capability' ? -190 : -40).distanceMax(420))
  .force('collide', d3.forceCollide(n => R(n) + (n.k === 'element' ? 5 : 9)).iterations(2))
  .force('x', d3.forceX(n => anchorOf(n).x).strength(n => n.k === 'domain' ? 0.5 : 0.06))
  .force('y', d3.forceY(n => anchorOf(n).y).strength(n => n.k === 'domain' ? 0.5 : 0.06))
  .stop().tick(520);
for (const n of nodes) { n.mx = n.x; n.my = n.y; }
for (const e of edges) {
  const h = hashOf(e.a + e.b);
  e.bend = ((h % 1000) / 1000 - 0.5) * 0.36 + (e.y === 'd' ? 0.14 : 0);
  e.phase = (h % 997) / 997; e.h = h;
  e.pm = curvePts({ x: e.A.mx, y: e.A.my }, { x: e.B.mx, y: e.B.my }, e.bend);
}

// ---------------------------------------------------------------- layout B: tiers (routed)
const TIER = { domain: -360, capability: 0, element: 330 };
const primaryCap = el => containers(el).find(c => c.k === 'capability') || null;
const capsOf = d => nodes.filter(n => n.k === 'capability' && domainOf(n) === d);
{
  let x = 0; const EL = 34, CAP = 78;
  for (const d of domains) {
    let prevCap = -Infinity;
    for (const c of capsOf(d)) {
      const els = nodes.filter(n => n.k === 'element' && primaryCap(n) === c);
      const start = x;
      for (const el of els) { el.tx = x; el.ty = TIER.element; x += EL; }
      c.tx = els.length ? (start + x - EL) / 2 : x;
      if (!els.length) x += EL;
      c.tx = Math.max(c.tx, prevCap + CAP); prevCap = c.tx; c.ty = TIER.capability;
      x = Math.max(x, c.tx + CAP / 2);
    }
    for (const el of nodes.filter(n => n.k === 'element' && domainOf(n) === d && !primaryCap(n))) { el.tx = x; el.ty = TIER.element; x += EL; }
    const cs = capsOf(d);
    d.tx = cs.length ? cs.reduce((a, c) => a + c.tx, 0) / cs.length : x; d.ty = TIER.domain;
    x += 80;
  }
  for (const n of nodes) if (n.tx === undefined) { n.tx = x; n.ty = TIER[n.k]; x += 40; }
  const mid = (Math.min(...nodes.map(n => n.tx)) + Math.max(...nodes.map(n => n.tx))) / 2;
  for (const n of nodes) n.tx -= mid;
}
const capIndex = new Map(nodes.filter(n => n.k === 'capability').map((c, i) => [c, i]));
const domIndex = new Map(domains.map((d, i) => [d, i]));
for (const e of edges) {
  const a = { x: e.A.tx, y: e.A.ty }, b = { x: e.B.tx, y: e.B.ty };
  let lane;
  if (e.y === 'c') {
    // a container's children rise to one shared channel just below it, then merge in: the tree reads as a bus
    lane = e.A.k === 'domain' ? TIER.capability - 96 - domIndex.get(e.A) * 11 : TIER.element - 92 - (capIndex.get(e.A) % 6) * 11;
    if (e.A.k === 'domain' && e.B.k === 'element') lane = TIER.capability - 150 - domIndex.get(e.A) * 7; // membership backbone crosses the capability tier
  } else if (e.A.ty === e.B.ty) {
    lane = e.A.ty - 36 - (e.h % 5) * 8; // a dependency inside a tier arcs over it
  } else {
    lane = (e.A.ty + e.B.ty) / 2 - 20 + (e.h % 5) * 8;
  }
  e.pt = orthoPts([a, { x: a.x, y: lane }, { x: b.x, y: lane }, b]);
}

// ---------------------------------------------------------------- views and morphing
let view = 'map', morph = null;
const posKey = { map: ['mx', 'my', 'pm'], tiers: ['tx', 'ty', 'pt'] };
function applyLayout(v, u = 1, from = null) {
  const [kx, ky, kp] = posKey[v];
  for (const n of nodes) { n.x = from ? lerp(n.fx ?? n[kx], n[kx], u) : n[kx]; n.y = from ? lerp(n.fy ?? n[ky], n[ky], u) : n[ky]; }
  for (const e of edges) e.P = from && e.fp ? e[kp].map((p, i) => ({ x: lerp(e.fp[i].x, p.x, u), y: lerp(e.fp[i].y, p.y, u) })) : e[kp];
}
applyLayout('map');

// ---------------------------------------------------------------- canvas + camera
const stage = $('#stage'), canvas = $('#map'), ctx = canvas.getContext('2d');
let W = 0, H = 0, DPR = 1;
const cam = { k: 1, x: 0, y: 0 };
let camAnim = null;
function resize() {
  const r = stage.getBoundingClientRect(); W = r.width; H = r.height; DPR = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
}
function fitFor(v, pad = 60) {
  const [kx, ky] = posKey[v];
  const xs = nodes.map(n => n[kx]), ys = nodes.map(n => n[ky]);
  const leftPx = v === 'tiers' && W > 760 ? LEGEND_PX : 0; // screen room for the tier legend
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys) - (v === 'tiers' ? 40 : 0), y1 = Math.max(...ys) + (v === 'tiers' ? 30 : 0);
  const k = Math.min((W - pad * 2 - leftPx) / (x1 - x0), (H - pad * 2) / (y1 - y0), 1.6);
  return { k, x: (W + leftPx) / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
}
const LEGEND_PX = 290;
const KEYS = 'arrows move · F focus · P path · [ ] back and forward · / find';
const sx = x => x * cam.k + cam.x, sy = y => y * cam.k + cam.y;
const spos = n => view === 'time' ? { x: n.px ?? -99, y: n.py ?? -99 } : { x: sx(n.x), y: sy(n.y) };
function flyTo(target, ms = 650) {
  if (REDUCED || ms === 0) { Object.assign(cam, target); camAnim = null; return; }
  camAnim = { from: { ...cam }, to: target, t0: performance.now(), ms };
}
function focusNode(n) {
  if (view === 'time' || view === 'trace') return;
  const k = Math.max(cam.k, view === 'tiers' ? 1.1 : 1.25);
  const side = (W > 900 ? -140 : 0) + (drawer && W > 900 ? 172 : 0);
  flyTo({ k, x: W / 2 + side - n.x * k, y: H / 2 - n.y * k });
}
function setView(v) {
  if (v === view && !morph) return;
  const prev = view; view = v;
  if (prev === 'studio' && v !== 'studio') { studio?.hide(); canvas.hidden = false; $('#studio').hidden = true; }
  document.querySelectorAll('#views button').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === v));
  $('#types').hidden = v !== 'time';
  $('#fcseg').hidden = v !== 'time' || !FC?.model;
  $('#lens').hidden = $('#filters').hidden = v === 'time' || v === 'trace' || v === 'studio';
  $('#srcwrap').hidden = v !== 'studio';
  if (v !== 'trace') closeTrace();
  $('#hint').textContent = v === 'time'
    ? 'Each slice is one real commit; the front slice is the current one · lines thread a concept through every change that touched it'
    : v === 'tiers' ? 'Elements, capabilities, domains in bands · connectors are real relations, routed · ' + KEYS : 'Drag to pan · scroll to zoom · ' + KEYS;
  if (v === 'studio') { closePop(); closeTrace(); canvas.hidden = true; mini.hidden = true; $('#studio').hidden = false; $('#hint').textContent = 'Drag to orbit · scroll to zoom where you point · click to focus · double-click to pick up and read · F focus · A face it · [ ] next · R reset'; openStudio(srcKey); return; }
  if (v === 'trace') { closePop(); hover = null; $('#hint').textContent = `Every route traced through its imports to buttons, intents, prompts, contracts and meaning · read from ${T.head} · click anything`; flyTo(traceFit(), REDUCED ? 0 : 500); return; }
  if (v === 'time') { timeDepth = cur; return; }
  const fromView = prev === 'time' ? (v === 'map' ? 'tiers' : 'map') : prev;
  for (const n of nodes) { n.fx = n.x; n.fy = n.y; }
  for (const e of edges) e.fp = e.P;
  if (prev === 'time' || prev === 'trace' || prev === 'studio') { applyLayout(v); Object.assign(cam, fitFor(v)); return; }
  morph = REDUCED ? null : { to: v, t0: performance.now(), ms: 900 };
  if (!morph) applyLayout(v);
  flyTo(fitFor(v), REDUCED ? 0 : 900);
  void fromView;
}
document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.view));

// ---------------------------------------------------------------- energy
const pulses = [];
let speed = 1;
const hopMs = () => REDUCED ? 0 : 520 / Math.sqrt(speed);
function fire(src, { delay = 0, strength = 1, cap = 140, work = 'build' } = {}) {
  const now = performance.now() + delay, H0 = hopMs();
  const r = reach(src);
  src.en = Math.max(src.en, strength); src.touch = 1; src.work = work;
  let budget = cap;
  for (const n of r.order) {
    if (n === src || budget-- <= 0) continue;
    const e = r.via.get(n), h = r.hop.get(n);
    if (REDUCED) { n.en = Math.max(n.en, strength * 0.8); continue; }
    pulses.push({ e, from: e.A === n ? e.B : e.A, to: n, t0: now + (h - 1) * H0, dur: H0 * 0.92, s: strength * Math.pow(0.86, h - 1), rgb: WORK[work].rgb });
  }
  return r;
}

// ---------------------------------------------------------------- interaction
let hover = null, selected = null, drag = null;
const pointers = new Map();
function pick(px, py) {
  if (view === 'trace') return null;
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (!nodeShown(n) || (focusSet && !focusSet.has(n))) continue;
    const p = spos(n), dx = p.x - px, dy = p.y - py, d = dx * dx + dy * dy;
    const r = view === 'time' ? 8 : Math.max(9, R(n) * cam.k + 5);
    if (d < r * r && d < bd) { bd = d; best = n; }
  }
  return best;
}
canvas.addEventListener('pointerdown', ev => {
  canvas.setPointerCapture(ev.pointerId);
  pointers.set(ev.pointerId, { x: ev.offsetX, y: ev.offsetY });
  drag = pointers.size === 1 ? { x: ev.offsetX, y: ev.offsetY, cx: cam.x, cy: cam.y, moved: 0 } : null;
  camAnim = null;
});
canvas.addEventListener('pointermove', ev => {
  const prev = pointers.get(ev.pointerId);
  if (pointers.size === 2 && prev && view !== 'time') {
    const [a, b] = [...pointers.values()];
    const d0 = Math.hypot(a.x - b.x, a.y - b.y);
    prev.x = ev.offsetX; prev.y = ev.offsetY;
    const [c, d] = [...pointers.values()];
    if (d0 > 0) zoomAt((c.x + d.x) / 2, (c.y + d.y) / 2, Math.hypot(c.x - d.x, c.y - d.y) / d0);
    return;
  }
  if (prev) { prev.x = ev.offsetX; prev.y = ev.offsetY; }
  if (drag) {
    const dx = ev.offsetX - drag.x, dy = ev.offsetY - drag.y;
    drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
    if (drag.moved > 3 && view !== 'time') { cam.x = drag.cx + dx; cam.y = drag.cy + dy; canvas.classList.add('dragging'); }
    return;
  }
  if (view === 'trace') { tHover = pickTrace(ev.offsetX, ev.offsetY); canvas.classList.toggle('over', !!tHover); return; }
  hover = pick(ev.offsetX, ev.offsetY);
  canvas.classList.toggle('over', !!hover);
});
function endPointer(ev) {
  pointers.delete(ev.pointerId);
  canvas.classList.remove('dragging');
  if (drag && drag.moved <= 3 && ev.type === 'pointerup' && view === 'trace') {
    const n = pickTrace(ev.offsetX, ev.offsetY);
    if (n) selectTrace(n); else closeTrace();
    drag = null; return;
  }
  if (drag && drag.moved <= 3 && ev.type === 'pointerup') {
    const n = pick(ev.offsetX, ev.offsetY);
    if (n) select(n); else closePop();
  }
  drag = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { if (!drag) hover = null; });
function zoomAt(px, py, f) {
  const k = Math.min(4, Math.max(0.3, cam.k * f)); f = k / cam.k;
  cam.x = px - (px - cam.x) * f; cam.y = py - (py - cam.y) * f; cam.k = k;
}
canvas.addEventListener('wheel', ev => { if (view === 'time') return; ev.preventDefault(); camAnim = null; zoomAt(ev.offsetX, ev.offsetY, Math.exp(-ev.deltaY * 0.0016)); }, { passive: false });

// ---------------------------------------------------------------- drawing: map and tiers
const COL = { t1: '#fafafa', t2: '#d4d4d4', t3: '#8f8f8f', t4: '#5e5e5e' };
function strokePts(pts, X = sx, Y = sy) {
  ctx.beginPath(); ctx.moveTo(X(pts[0].x), Y(pts[0].y));
  for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i].x), Y(pts[i].y));
  ctx.stroke();
}
const neighbours = n => new Set([n, ...incident.get(n).map(e => e.A === n ? e.B : e.A)]);
function drawTierBands() {
  const u = view === 'tiers' ? (morph ? ease(Math.min(1, (performance.now() - morph.t0) / morph.ms)) : 1) : (morph && morph.to === 'map' ? 1 - ease(Math.min(1, (performance.now() - morph.t0) / morph.ms)) : 0);
  if (u < 0.02) return;
  const xs = nodes.map(n => n.tx), x0 = Math.min(...xs), x1 = Math.max(...xs);
  const seps = [TIER.domain - 70, (TIER.domain + TIER.capability) / 2 - 40, (TIER.capability + TIER.element) / 2 - 30, TIER.element + 44];
  ctx.save(); ctx.globalAlpha = u;
  ctx.setLineDash([6, 7]); ctx.strokeStyle = 'rgba(255,255,255,0.1)'; ctx.lineWidth = 1;
  for (const y of seps) { ctx.beginPath(); ctx.moveTo(sx(x0) - LEGEND_PX, sy(y)); ctx.lineTo(sx(x1 + 40), sy(y)); ctx.stroke(); }
  ctx.setLineDash([]);
  // The gates that hold each band in this repository (package.json scripts), read bottom-up.
  const bands = [
    { y: TIER.element, name: 'Elements · within a capability', gates: ['pnpm lint · FSD import direction', 'vitest unit tests', 'pnpm knip · dead-code ratchet', 'validate_vault · schema'] },
    { y: TIER.capability, name: 'Capabilities · across capabilities', gates: ['tests/contract · shared behaviour', 'same-layer cross-import ratchet', 'pnpm decisions:check', 'pnpm docs:links'] },
    { y: TIER.domain, name: 'Domains · the core', gates: ['pnpm agents:check · the builders', 'pnpm docs-vault:build', 'pnpm po:route · design:route', 'en / ko locales'] },
  ];
  const lx = sx(x0) - LEGEND_PX + 24;
  ctx.textAlign = 'left';
  for (const b of bands) {
    const y = sy(b.y) - 30;
    ctx.font = '500 10.5px "Geist Mono", ui-monospace, monospace'; ctx.fillStyle = COL.t2;
    ctx.letterSpacing = '0.8px'; ctx.fillText(b.name.toUpperCase(), lx, y); ctx.letterSpacing = '0px';
    ctx.font = '12px Geist, system-ui, sans-serif'; ctx.fillStyle = COL.t3;
    b.gates.forEach((g, i) => ctx.fillText(g, lx, y + 18 + i * 16));
  }
  // flow arrows between bands: meaning is enforced low and composed upward
  ctx.strokeStyle = 'rgba(255,255,255,0.32)'; ctx.fillStyle = 'rgba(255,255,255,0.32)'; ctx.lineWidth = 1.2;
  for (const [a, b] of [[TIER.element, TIER.capability], [TIER.capability, TIER.domain]]) {
    const x = lx - 18, ya = sy(a) - 34, yb = sy(b) + 60;
    ctx.beginPath(); ctx.moveTo(x, ya); ctx.quadraticCurveTo(x - 14, (ya + yb) / 2, x, yb); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, yb - 1); ctx.lineTo(x - 4, yb + 7); ctx.lineTo(x + 4, yb + 6); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}
function drawEdges(t) {
  const focus = selected || hover, lit = focus ? new Set(incident.get(focus)) : null;
  const tiers = view === 'tiers';
  for (const e of edges) {
    if (!edgeShown(e)) continue;
    const dep = e.y !== 'c';
    let a;
    if (lit) a = lit.has(e) ? (dep ? 0.72 : 0.46) : (dep ? 0.05 : 0.03);
    else if (tiers) a = dep ? 0.3 : (e.A.k === 'domain' && e.B.k === 'element' ? 0.045 : 0.16);
    else a = dep ? 0.17 : 0.075;
    if (focusSet && !(focusSet.has(e.A) && focusSet.has(e.B))) a *= 0.12;
    if (pathSel && !pathSel.eset.has(e)) a *= 0.35;
    ctx.strokeStyle = `rgba(255,255,255,${a})`; ctx.lineWidth = tiers && !dep ? 1.25 : 1;
    if (dep || e.draft) ctx.setLineDash(e.draft ? [4, 4] : [2.5, 3.5]);
    strokePts(e.P);
    ctx.setLineDash([]);
  }
  if (pathSel) {
    ctx.strokeStyle = 'rgba(255,255,255,0.92)'; ctx.lineWidth = 2;
    for (const e of pathSel.edges) strokePts(e.P);
  }
  if (tiers && !morph) {
    // intersections: where a child's riser meets its parent's bus
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    for (const e of edges) { if (e.y !== 'c' || !edgeShown(e) || (e.A.k === 'domain' && e.B.k === 'element')) continue; const p = e.pt[Math.round(NPTS * 0.18)]; ctx.fillRect(sx(e.B.tx) - 1, sy(p.y) - 1, 2, 2); }
  }
  if (!REDUCED) {
    ctx.fillStyle = '#ffffff';
    for (const e of edges) {
      if (e.y !== 'd' || !edgeShown(e) || (focusSet && !(focusSet.has(e.A) && focusSet.has(e.B)))) continue;
      const p = (t * Math.sqrt(speed) / 5200 + e.phase) % 1;
      const q = pointOn(e.P, 1 - p); // current flows from the dependency to its dependent
      ctx.globalAlpha = 0.14 + 0.3 * Math.sin(p * Math.PI);
      ctx.beginPath(); ctx.arc(sx(q.x), sy(q.y), 1.1, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
function advancePulses(t, draw) {
  if (draw) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; }
  for (let i = pulses.length - 1; i >= 0; i--) {
    const p = pulses[i], u = (t - p.t0) / p.dur;
    if (u < 0) continue;
    if (u >= 1) { p.to.en = Math.max(p.to.en, p.s); p.e.en = Math.max(p.e.en, p.s * 0.8); p.e.rgb = p.rgb; pulses.splice(i, 1); continue; }
    if (!draw) continue;
    const rev = p.from === p.e.B, pos = s => pointOn(p.e.P, rev ? 1 - s : s);
    const head = ease(u), tail = Math.max(0, head - 0.34), N = 14;
    let prev = pos(tail);
    for (let j = 1; j <= N; j++) {
      const q = pos(tail + (head - tail) * (j / N)), a = j / N;
      ctx.strokeStyle = `rgba(${p.rgb},${(0.08 + 0.7 * a * a) * p.s})`; ctx.lineWidth = 0.8 + 2.4 * a * a;
      ctx.beginPath(); ctx.moveTo(sx(prev.x), sy(prev.y)); ctx.lineTo(sx(q.x), sy(q.y)); ctx.stroke();
      prev = q;
    }
    const hx = sx(prev.x), hy = sy(prev.y), g = ctx.createRadialGradient(hx, hy, 0, hx, hy, 12);
    g.addColorStop(0, `rgba(255,255,255,${0.95 * p.s})`); g.addColorStop(0.28, `rgba(${p.rgb},${0.6 * p.s})`); g.addColorStop(1, `rgba(${p.rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(hx, hy, 12, 0, Math.PI * 2); ctx.fill();
  }
  if (!draw) return;
  for (const e of edges) {
    if (e.en < 0.02) continue;
    ctx.strokeStyle = `rgba(${e.rgb || '255,255,255'},${0.5 * e.en})`; ctx.lineWidth = 1.5; strokePts(e.P);
  }
  ctx.restore();
}
function drawNode(n, x, y, r, hot, g = ctx, shade = null) {
  const lit = v => Math.round(v + (255 - v) * Math.min(1, hot));
  if (n.k === 'domain') {
    g.fillStyle = '#0c0c0c'; g.strokeStyle = COL.t1; g.lineWidth = 1.6;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = COL.t1; g.beginPath(); g.arc(x, y, r * 0.34, 0, Math.PI * 2); g.fill();
  } else if (n.k === 'capability') {
    g.fillStyle = shade || (hot > 0.05 ? `rgb(${lit(212)},${lit(212)},${lit(212)})` : COL.t2);
    g.strokeStyle = '#0c0c0c'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.fill();
  } else {
    g.fillStyle = shade || (hot > 0.05 ? `rgb(${lit(143)},${lit(143)},${lit(143)})` : COL.t3);
    const s = r * 1.7; g.fillRect(x - s / 2, y - s / 2, s, s);
  }
}
function halo(n, x, y, r, g = ctx) {
  if (n.en >= 0.02) {
    const rgb = WORK[n.work || 'build'].rgb, rr = r + 16 * n.en + 4, gr = g.createRadialGradient(x, y, r * 0.6, x, y, rr);
    gr.addColorStop(0, `rgba(${rgb},${0.5 * n.en})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  if (n.touch >= 0.02) {
    g.strokeStyle = `rgba(232,230,217,${0.85 * n.touch})`; g.lineWidth = 1.4;
    g.beginPath(); g.arc(x, y, r + 5 + (1 - n.touch) * 10, 0, Math.PI * 2); g.stroke();
  }
}
function drawNodes(t) {
  const focus = selected || hover, near = focus ? neighbours(focus) : null;
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const n of nodes) if (nodeShown(n) && (n.en >= 0.02 || n.touch >= 0.02) && (!focusSet || focusSet.has(n))) halo(n, sx(n.x), sy(n.y), R(n) * Math.max(0.8, cam.k));
  ctx.restore();
  for (const n of nodes) {
    if (!nodeShown(n)) continue;
    const x = sx(n.x), y = sy(n.y), r = R(n) * Math.max(0.8, cam.k);
    ctx.globalAlpha = focusSet && !focusSet.has(n) ? 0.09 : near && !near.has(n) && !(pathSel && pathSel.set.has(n)) ? 0.3 : 1;
    drawNode(n, x, y, r, n.en, ctx, lensShade(n));
    if (n.draft) { ctx.setLineDash([3, 3]); ctx.strokeStyle = COL.t1; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, r + 4, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]); }
    if (lens === 'alignment' && n.align && n.align.after > 0) {
      // drift mark: a broken ring, one gap per commit the page has not caught up with
      const gaps = Math.min(6, n.align.after), seg = (Math.PI * 2) / gaps;
      ctx.strokeStyle = COL.t1; ctx.lineWidth = 1.3;
      for (let i = 0; i < gaps; i++) { ctx.beginPath(); ctx.arc(x, y, r + 5, i * seg + 0.35, (i + 1) * seg - 0.35); ctx.stroke(); }
    }
    if (n === selected) {
      const breathe = REDUCED ? 0 : Math.sin(t / 520) * 1.2;
      ctx.strokeStyle = COL.t1; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r + 7 + breathe, 0, Math.PI * 2); ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}
function drawLabels() {
  const focus = selected || hover, near = focus ? neighbours(focus) : null, tiers = view === 'tiers';
  const cand = [];
  for (const n of nodes) {
    if (!nodeShown(n) || (focusSet && !focusSet.has(n))) continue;
    let pri = -1;
    if (n === selected) pri = 100; else if (n === hover) pri = 90;
    else if (pathSel && pathSel.set.has(n)) pri = 75;
    else if (lens === 'alignment' && n.align && n.align.after > 0) pri = 72;
    else if (focusSet && n.k !== 'element') pri = 65;
    else if (n.k === 'domain') pri = 80;
    else if (near && near.has(n)) pri = 60;
    else if (n.en > 0.35) pri = 50;
    else if (n.k === 'capability' && cam.k > (tiers ? 0.7 : 0.95)) pri = 30;
    else if (n.k === 'element' && cam.k > 1.9) pri = 10;
    if (pri >= 0) cand.push({ n, pri });
  }
  cand.sort((a, b) => b.pri - a.pri);
  const placed = [];
  for (const { n, pri } of cand) {
    const dom = n.k === 'domain';
    ctx.font = dom ? '500 10.5px "Geist Mono", ui-monospace, monospace' : `${pri >= 90 ? 600 : 500} 11.5px Geist, ui-sans-serif, system-ui, sans-serif`;
    const drift = lens === 'alignment' && n.align && n.align.after > 0;
    const text = dom ? n.t.toUpperCase() : drift ? `${n.t}  ·  code +${n.align.after}` : n.t;
    const w = ctx.measureText(text).width + (dom ? text.length * 0.9 : 0);
    const x = sx(n.x), r = R(n) * Math.max(0.8, cam.k);
    // in tiers, capability labels sit above the node so they never collide with the bus below
    const y = dom ? sy(n.y) - r - 10 : tiers && n.k === 'capability' ? sy(n.y) - r - 8 : sy(n.y) + r + 13;
    const box = { x0: x - w / 2 - 3, x1: x + w / 2 + 3, y0: y - 11, y1: y + 4 };
    if (pri < 90 && placed.some(b => b.x0 < box.x1 && box.x0 < b.x1 && b.y0 < box.y1 && box.y0 < b.y1)) continue;
    placed.push(box);
    ctx.textAlign = 'center';
    if (dom) ctx.letterSpacing = '0.9px';
    ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(9,10,11,0.92)'; ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = dom ? COL.t3 : pri >= 60 || n.en > 0.35 ? COL.t1 : COL.t3;
    ctx.fillText(text, x, y);
    if (dom) ctx.letterSpacing = '0px';
  }
}

// ---------------------------------------------------------------- forecast: what the history predicts next
// Built by extract/forecast.mjs from commits already seen at each point, never later ones. A slice shows
// the forecast made just after its commit; the model's hold-out score travels with it so a reader can
// judge the rings instead of trusting them.
const fcIndex = (() => {
  const byHash = new Map(), list = FC?.steps || [];
  list.forEach((st, i) => byHash.set(st.h, i));
  const ts = list.map(st => +new Date(st.d));
  return c => {
    if (!list.length) return -1;
    if (byHash.has(c.h)) return byHash.get(c.h);
    const t = +new Date(c.d); let lo = -1;
    for (let i = 0; i < ts.length && ts[i] <= t; i++) lo = i;
    return lo;
  };
})();
const fcStep = c => { const i = fcIndex(c); return i >= 0 ? FC.steps[i] : null; };
function forecastOn() { return showForecast && !!FC?.model && view === 'time'; }
document.getElementById('fc')?.addEventListener('click', ev => { showForecast = !showForecast; ev.currentTarget.setAttribute('aria-pressed', showForecast); });
addEventListener('keydown', ev => { if ((ev.key === 'f' || ev.key === 'F') && view === 'time' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) document.getElementById('fc')?.click(); });

function drawForecast(plane, proj, front) {
  const st = fcStep(commits[cur]); if (!st) return;
  const ghost = plane(-1.2), items = st.forecast || [];
  const happened = new Set(st.actualNext || []);
  ctx.save();
  ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1;
  ctx.strokeRect(ghost.x + 0.5, ghost.y + 0.5, ghost.w, ghost.h); ctx.setLineDash([]);
  ctx.font = '10px "Geist Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = COL.t3;
  ctx.fillText(st.actualNext ? 'NEXT · FORECAST vs WHAT CHANGED' : 'NEXT · FORECAST', ghost.x + 6, ghost.y + 14);
  items.forEach((it, rank) => {
    const n = byId.get(it.s); if (!n) return;
    // size and label by rank: the audit found the probabilities no better than the base rate
    const q = proj(n.mx, n.my, ghost), f = proj(n.mx, n.my, front), rel = 1 - rank / items.length;
    const r = 3 + 8 * rel, hit = happened.has(it.s);
    ctx.strokeStyle = `rgba(255,255,255,${0.12 + 0.3 * rel})`; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(q.x, q.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
    if (hit) { ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill(); }
    ctx.strokeStyle = `rgba(255,255,255,${0.35 + 0.6 * rel})`; ctx.lineWidth = rank === 0 ? 1.6 : 1; ctx.stroke();
    it._x = q.x; it._y = q.y; it._r = r;
    if (rank < (W < 640 || H < 420 ? 1 : 3)) {
      ctx.font = '600 10.5px Geist, system-ui, sans-serif'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(9,10,11,0.9)';
      const label = `#${rank + 1} ${n.t}`;
      ctx.strokeText(label, q.x + r + 4, q.y + 3); ctx.fillStyle = COL.t1; ctx.fillText(label, q.x + r + 4, q.y + 3);
    }
  });
  // what changed next but was not forecast: a small cross, so misses stay visible
  for (const s of happened) {
    if (items.some(it => it.s === s)) continue;
    const n = byId.get(s); if (!n) continue;
    const q = proj(n.mx, n.my, ghost);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(q.x - 3, q.y - 3); ctx.lineTo(q.x + 3, q.y + 3); ctx.moveTo(q.x + 3, q.y - 3); ctx.lineTo(q.x - 3, q.y + 3); ctx.stroke();
  }
  ctx.restore();
}

function forecastLegend(y) {
  // the verdict comes from the audit, so the legend never claims more than the checks allow
  const m = FC.model, a = FC.audit, f = x => x == null ? 'n/a' : x.toFixed(2);
  const beats = a?.ok && a.interval.lo > 0, loses = a?.ok && a.interval.hi < 0;
  const verdict = !a?.ok ? '' : beats ? 'BEATS RECENCY' : loses ? 'WORSE THAN RECENCY' : 'NOT BETTER THAN RECENCY';
  ctx.font = '10px "Geist Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = COL.t4;
  const compact = W < 640 || H < 420;
  const text = compact
    ? `○ forecast (#rank) · ● happened · × missed · ${verdict.toLowerCase()}`
    : `○ FORECAST, BY RANK · ● HAPPENED · × MISSED · BRIGHT SLICE = SURPRISING · HOLD-OUT MRR ${f(m.mrr)} vs RECENCY ${f(m.baselines.recency)} (${m.heldOut} COMMITS): ${verdict}` +
      (a?.ok ? ` · NEW WORK ${f(a.repeats.novelModel)} vs RANDOM ${f(a.random)}` : '');
  ctx.fillText(text, 8, y);
  if (a?.flags?.length && !compact) { ctx.fillStyle = COL.t4; ctx.fillText(`AUDIT: ${a.flags.length} caveat${a.flags.length === 1 ? '' : 's'} · atlas-current audit`, 8, y + 14); }
}

// ---------------------------------------------------------------- drawing: time (commits as slices)
let timeDepth = 0;
const mapBox = (() => { const xs = nodes.map(n => n.mx), ys = nodes.map(n => n.my); return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }; })();
const touchesOf = new Map(nodes.map(n => [n, []]));
commits.forEach((c, i) => c.nodes.forEach(n => touchesOf.get(n).push(i)));
function drawTime(dt) {
  timeDepth += (cur - timeDepth) * (1 - Math.exp(-dt / (REDUCED ? 1 : 260)));
  const visible = Math.max(6, timeDepth + 1); // the stack grows as history plays
  // Fit the whole volume inside the stage: front face, history depth, the date labels on its left and the
  // axis line under it, below the tool row and above the hint. Depth takes a share of the room, never all.
  const narrow = W < 640, padL = narrow ? 40 : 52, padR = 16, padT = 56, padB = 34 + (H > 420 ? 26 : 0) + (forecastOn() ? (W < 640 || H < 420 ? 16 : 32) : 0);
  const availW = Math.max(120, W - padL - padR), availH = Math.max(80, H - padT - padB);
  const depthShare = narrow ? 0.3 : 0.4;
  const Sw = Math.min(640, availW * (1 - depthShare), availH * (1 - depthShare * 0.6) / 0.62), Sh = Sw * 0.62;
  const step = Math.max(0.5, Math.min(22, (availW - Sw) / (visible * 0.86 + (forecastOn() ? 1.2 : 0)), (availH - Sh) / (visible * 0.4 + (forecastOn() ? 0.6 : 0))));
  const lead = forecastOn() ? 1.2 : 0; // room in front of the present for the forecast slice
  const boxW = Sw + (visible + lead) * step * 0.86, boxH = Sh + (visible + lead) * step * 0.4;
  const ox = padL + (availW - boxW) / 2 + visible * step * 0.86, oy = padT + (availH - boxH) / 2 + visible * step * 0.4;
  const plane = k => { const s = 1 - k * 0.006; return { x: ox - k * step * 0.86, y: oy - k * step * 0.4, w: Sw * s, h: Sh * s }; };
  const mg = 0.07, bw = mapBox.x1 - mapBox.x0, bh = mapBox.y1 - mapBox.y0;
  const proj = (x, y, pl) => ({ x: pl.x + (mg + (1 - 2 * mg) * (x - mapBox.x0) / bw) * pl.w, y: pl.y + (mg + (1 - 2 * mg) * (y - mapBox.y0) / bh) * pl.h });
  const kOf = i => timeDepth - i;
  const oldest = plane(Math.max(0, kOf(0))), front = plane(Math.max(0, kOf(Math.min(cur, commits.length - 1))));
  // box wireframe, like a video volume: front face, back face, and the four depth edges
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
  const corners = pl => [[pl.x, pl.y], [pl.x + pl.w, pl.y], [pl.x + pl.w, pl.y + pl.h], [pl.x, pl.y + pl.h]];
  const fc = corners(front), bc = corners(oldest);
  ctx.beginPath(); bc.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.closePath(); ctx.stroke();
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(bc[i][0], bc[i][1]); ctx.lineTo(fc[i][0], fc[i][1]); ctx.stroke(); }
  // slices, back to front
  for (let i = 0; i <= cur; i++) {
    const k = kOf(i); if (k < -0.5) continue;
    const pl = plane(Math.max(0, k)), c = commits[i], wk = WORK[c.w];
    const age = Math.min(1, Math.max(0, k) / visible);
    ctx.fillStyle = `rgba(255,255,255,${0.012 + (i === cur ? 0.02 : 0)})`; ctx.fillRect(pl.x, pl.y, pl.w, pl.h);
    const sp = forecastOn() ? (fcStep(c)?.surprise ?? 0.5) : 0.5; // 0 = expected, 1 = no better than a guess
    ctx.strokeStyle = `rgba(${wk.rgb},${(0.1 + 0.25 * (1 - age)) * (0.45 + 1.1 * sp)})`; ctx.strokeRect(pl.x + 0.5, pl.y + 0.5, pl.w, pl.h);
    ctx.fillStyle = `rgba(${wk.rgb},${0.55 * (1 - age * 0.7)})`;
    for (const n of c.nodes) { const p = proj(n.mx, n.my, pl); ctx.beginPath(); ctx.arc(p.x, p.y, 1.9, 0, Math.PI * 2); ctx.fill(); }
    if (i === cur || i % 6 === 0) {
      ctx.font = '10px "Geist Mono", ui-monospace, monospace'; ctx.textAlign = 'right';
      ctx.fillStyle = i === cur ? COL.t2 : COL.t4; ctx.fillText(c.d.slice(5, 10).replace('-', '.'), pl.x - 6, pl.y + pl.h);
    }
  }
  // worldlines: one concept threaded through every change that touched it
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const n of nodes) {
    const hits = touchesOf.get(n).filter(i => i <= cur && kOf(i) >= -0.5);
    if (hits.length < 2) continue;
    const wk = WORK[commits[hits[hits.length - 1]].w];
    ctx.strokeStyle = `rgba(${wk.rgb},${n === selected || n === hover ? 0.9 : 0.2})`; ctx.lineWidth = n === selected || n === hover ? 1.6 : 0.9;
    ctx.beginPath();
    hits.forEach((i, j) => { const p = proj(n.mx, n.my, plane(Math.max(0, kOf(i)))); if (j) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    const f = proj(n.mx, n.my, front); ctx.lineTo(f.x, f.y);
    ctx.stroke();
  }
  ctx.restore();
  // the front face is the living map at this commit
  ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1;
  for (const e of edges) { ctx.beginPath(); e.pm.forEach((p, i) => { const q = proj(p.x, p.y, front); if (i) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); }); ctx.stroke(); }
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const n of nodes) { const p = proj(n.mx, n.my, front); n.px = p.x; n.py = p.y; if (n.en >= 0.02 || n.touch >= 0.02) halo(n, p.x, p.y, 3); }
  ctx.restore();
  const now = new Set(commits[cur]?.nodes || []);
  for (const n of nodes) {
    const r = n.k === 'domain' ? 6 : n.k === 'capability' ? 3.4 : 2;
    ctx.globalAlpha = now.has(n) || n === selected ? 1 : 0.45;
    drawNode(n, n.px, n.py, r, now.has(n) ? 1 : n.en);
    if (n === selected) { ctx.strokeStyle = COL.t1; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(n.px, n.py, r + 5, 0, Math.PI * 2); ctx.stroke(); }
  }
  ctx.globalAlpha = 1;
  const lab = selected || hover;
  if (lab) { ctx.font = '600 11.5px Geist, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(9,10,11,0.92)'; ctx.strokeText(lab.t, lab.px, lab.py + 16); ctx.fillStyle = COL.t1; ctx.fillText(lab.t, lab.px, lab.py + 16); }
  // axis
  ctx.font = '10px "Geist Mono", ui-monospace, monospace'; ctx.textAlign = 'right'; ctx.fillStyle = COL.t4;
  if (forecastOn()) drawForecast(plane, proj, front);
  const axis = W < 560 ? `${cur + 1}/${commits.length} · ${commits[0].d.slice(5, 10)} → ${commits[cur].d.slice(5, 10)}`
    : `EARLIER ↖   ${cur + 1} OF ${commits.length} COMMITS · ${commits[0].d.slice(0, 10)} → ${commits[cur].d.slice(0, 10)}   ↘ THIS COMMIT`;
  const ax = Math.min(fc[2][0], W - 8), ay = Math.min(fc[2][1] + 22, H - 6);
  if (ax - ctx.measureText(axis).width < 8) { ctx.textAlign = 'left'; ctx.fillText(axis, 8, ay); } else ctx.fillText(axis, ax, ay);
  if (forecastOn()) forecastLegend(Math.min(ay + 16, H - 4));
}

// ---------------------------------------------------------------- code edges from code-graph-rag
function drawCodeEdges(t) {
  if (!showCodeEdges) return;
  ctx.save();
  for (const e of codeEdges) {
    if (!nodeShown(e.A) || !nodeShown(e.B)) continue;
    const a = spos(e.A), b = spos(e.B), w = Math.min(3, 0.8 + Math.log2(1 + e.calls + e.imports) * 0.45);
    const hot = selected && (selected === e.A || selected === e.B);
    ctx.globalAlpha = e.declared ? (hot ? 0.55 : 0.22) : (hot ? 1 : 0.7);
    ctx.strokeStyle = e.declared ? '#8f8f8f' : '#fafafa'; ctx.lineWidth = w;
    ctx.setLineDash(e.declared ? [] : [5, 5]); ctx.lineDashOffset = e.declared ? 0 : -t / 60;
    const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y); ctx.stroke();
    // arrowhead at the callee
    const ang = Math.atan2(b.y - my, b.x - mx), r = R(e.B) * cam.k + 4;
    const hx = b.x - Math.cos(ang) * r, hy = b.y - Math.sin(ang) * r;
    ctx.setLineDash([]); ctx.fillStyle = ctx.strokeStyle; ctx.beginPath();
    ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(ang - 0.45) * 7, hy - Math.sin(ang - 0.45) * 7); ctx.lineTo(hx - Math.cos(ang + 0.45) * 7, hy - Math.sin(ang + 0.45) * 7); ctx.fill();
  }
  ctx.restore();
}

// ---------------------------------------------------------------- frame loop
let last = performance.now();
function frame(t) {
  const dt = Math.min(64, t - last); last = t;
  if (morph) {
    const u = Math.min(1, (t - morph.t0) / morph.ms);
    applyLayout(morph.to, ease(u), true);
    if (u >= 1) { applyLayout(morph.to); morph = null; }
  }
  if (camAnim) {
    const u = Math.min(1, (t - camAnim.t0) / camAnim.ms), e = 1 - Math.pow(1 - u, 3);
    for (const k of ['k', 'x', 'y']) cam[k] = camAnim.from[k] + (camAnim.to[k] - camAnim.from[k]) * e;
    if (u >= 1) camAnim = null;
  }
  if (view === 'studio') { requestAnimationFrame(frame); return; } // the studio renders itself
  const decay = Math.exp(-dt / 1100), fade = Math.exp(-dt / 700);
  for (const n of nodes) { n.en *= decay; n.touch *= fade; }
  for (const e of edges) e.en *= fade;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (view === 'time') { advancePulses(t, false); drawTime(dt); }
  else if (view === 'trace') { advancePulses(t, false); drawTrace(t, dt); }
  else { drawTierBands(); drawEdges(t); advancePulses(t, true); drawNodes(t); drawLabels(); drawCodeEdges(t); for (const f of liveHooks.overlay) f(ctx, t, spos); }
  placePop(); drawMini(); tipFrame();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- documents, decks, replays
const shortUid = u => (u || '').split('-')[0];
const blocksHtml = bs => bs.map(b => b.ul ? `<ul>${b.ul.map(li => `<li>${inline(li)}</li>`).join('')}</ul>` : `<p>${inline(b.p)}</p>`).join('');
function renderPaper(n, withNotes = true) {
  const d = n.doc, dom = domainOf(n), deps = dependsOn(n);
  const notes = withNotes && n.notes.length ? `<div class="notes"><strong>Relation notes</strong><ol>${n.notes.map(([to, text]) => `<li><span class="to">→ ${esc(byId.get(to)?.t || to)}</span>${inline(text)}</li>`).join('')}</ol></div>` : '';
  return `<article class="paper">
    <div class="lh"><span>Ontology Atlas · ${KIND[n.k]}</span><span>${esc(n.file)}</span></div>
    <h1>${esc(n.t)}</h1>
    ${d.desc ? `<p class="standfirst">${inline(d.desc)}</p>` : ''}
    <dl class="meta">
      ${n.p ? `<dt>Implementation</dt><dd>${esc(n.p)}</dd>` : ''}
      ${dom && dom !== n ? `<dt>Domain</dt><dd>${esc(dom.t)}</dd>` : ''}
      ${deps.length ? `<dt>Depends on</dt><dd>${deps.map(x => esc(x.t)).join(', ')}</dd>` : ''}
      ${n.by ? `<dt>Recorded by</dt><dd>${esc(n.by)}</dd>` : ''}
      <dt>Revision</dt><dd>${n.revs} · ${esc(n.last.h)} · ${esc(n.last.d)}</dd>
    </dl>
    ${blocksHtml(d.rest || [])}${d.sections.map(s => `<h3>${esc(s.h)}</h3>${blocksHtml(s.blocks)}`).join('')}${notes}
    <div class="folio"><span>uid ${esc(shortUid(n.uid))}</span><span>${esc(n.s)}</span></div>
  </article>`;
}

function deckFor(dom) {
  const caps = contents(dom).filter(c => c.k === 'capability');
  const members = new Set(reach(dom).order);
  const hist = commits.filter(c => c.nodes.some(n => members.has(n)));
  const elements = [...members].filter(m => m.k === 'element').length;
  const total = caps.length + 3;
  const foot = i => `<div class="foot"><span>Ontology Atlas · ${esc(dom.t)} · domain brief</span><span>${i} / ${total}</span></div>`;
  const slides = [];
  slides.push(`<div class="slide"><div class="kick">Domain brief</div><h3 class="xl">${esc(dom.t)}</h3><p class="lead">${inline(dom.doc.desc)}</p>
    <div class="stats"><div class="stat"><b>${caps.length}</b><span>Capabilities</span></div><div class="stat"><b>${elements}</b><span>Elements</span></div><div class="stat"><b>${hist.length}</b><span>Recorded changes</span></div><div class="stat"><b>${esc((hist[hist.length - 1]?.d || '').slice(5, 10).replace('-', '.'))}</b><span>Last change</span></div></div>${foot(1)}</div>`);
  slides.push(`<div class="slide"><div class="kick">What it holds</div><h3>${caps.length} capabilities, one boundary</h3><div class="grid">${caps.slice(0, 9).map(c => `<div class="card"><b>${esc(c.t)}</b><span>${esc(firstSentence(c.doc.desc))}</span></div>`).join('')}</div>${foot(2)}</div>`);
  caps.forEach((c, i) => {
    const inc = (c.doc.sections.find(s => /^includes/i.test(s.h))?.blocks.flatMap(b => b.ul || []) || []).slice(0, 4);
    const els = contents(c).filter(x => x.k === 'element'), deps = dependsOn(c);
    slides.push(`<div class="slide"><div class="kick">Capability ${i + 1} of ${caps.length}</div><h3>${esc(c.t)}</h3>
      <div class="cols"><div><p class="lead" style="font-size:18px;margin-bottom:18px">${inline(firstSentence(c.doc.desc))}</p>${inc.length ? `<ul class="inc">${inc.map(x => `<li>${inline(x)}</li>`).join('')}</ul>` : ''}</div>
      <div class="side">${els.length ? `<h4>Elements</h4><div class="chips">${els.map(x => `<span class="chip">${esc(x.t)}</span>`).join('')}</div>` : ''}${deps.length ? `<h4>Depends on</h4><div class="chips">${deps.map(x => `<span class="chip dep">${esc(x.t)}</span>`).join('')}</div>` : ''}${c.p ? `<h4>Entry point</h4><div class="chip" style="font-family:var(--mono);font-size:12.5px;display:inline-block">${esc(c.p)}</div>` : ''}</div></div>${foot(i + 3)}</div>`);
  });
  slides.push(historySlide(dom, hist, total));
  return slides;
}
function historySlide(dom, hist, total) {
  const all = commits.map(c => c.t), t0 = Math.min(...all), t1 = Math.max(...all), WEEK = 7 * 864e5;
  const bins = Math.max(1, Math.ceil((t1 - t0) / WEEK) + 1);
  // stacked by kind of work, one scale for the whole vault history
  const counts = Array.from({ length: bins }, () => ({ build: 0, repair: 0, plan: 0, tend: 0 }));
  for (const c of hist) counts[Math.floor((c.t - t0) / WEEK)][c.w]++;
  const max = Math.max(1, ...counts.map(b => b.build + b.repair + b.plan + b.tend));
  const cw = 420, ch = 190, bw = cw / bins;
  const bars = counts.map((b, i) => {
    let y = ch; return ['build', 'repair', 'plan', 'tend'].map(k => { const h = (b[k] / max) * ch; y -= h; return h ? `<rect x="${(i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" fill="${WORK[k].col}"/>` : ''; }).join('');
  }).join('');
  const fmt = t => new Date(t).toISOString().slice(5, 10).replace('-', '.');
  const svg = `<svg width="${cw + 40}" height="${ch + 36}" viewBox="-30 -8 ${cw + 40} ${ch + 36}" role="img" aria-label="Changes per week by kind of work">
    <line x1="0" x2="${cw}" y1="${ch}" y2="${ch}" stroke="#2a2b30"/><line x1="0" x2="${cw}" y1="0" y2="0" stroke="#1f2023" stroke-dasharray="3 4"/>
    <text x="-8" y="4" fill="#8a8f98" font-size="11" text-anchor="end" font-family="Geist Mono, monospace">${max}</text>
    <text x="-8" y="${ch + 4}" fill="#8a8f98" font-size="11" text-anchor="end" font-family="Geist Mono, monospace">0</text>
    ${bars}
    <text x="0" y="${ch + 22}" fill="#8a8f98" font-size="11" font-family="Geist Mono, monospace">${fmt(t0)}</text>
    <text x="${cw}" y="${ch + 22}" fill="#8a8f98" font-size="11" text-anchor="end" font-family="Geist Mono, monospace">${fmt(t1)}</text></svg>`;
  const key = ['build', 'repair', 'plan', 'tend'].map(k => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:14px"><i style="width:9px;height:9px;border-radius:2px;background:${WORK[k].col};display:inline-block"></i>${WORK[k].label}</span>`).join('');
  const recent = hist.slice(-4).reverse();
  return `<div class="slide"><div class="kick">How it changed</div><h3>${hist.length} recorded changes touched this domain</h3>
    <div class="cols"><div>${svg}<div class="kbd" style="margin-top:8px;font-size:12px;color:#8a8f98">${key}</div></div>
    <div class="side"><h4>Latest</h4><ul class="commits">${recent.map(c => `<li><span class="mono">${esc(c.d.slice(0, 10))}</span><span>${esc(c.s.replace(/^\w+(\([^)]*\))?:\s*/, ''))}</span></li>`).join('')}</ul></div></div>
    <div class="foot"><span>Ontology Atlas · ${esc(dom.t)} · domain brief</span><span>${total} / ${total}</span></div></div>`;
}

/** A replay is a pure function of time, so scrubbing and playing show the same frames. */
class Replay {
  constructor(canvas, src) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.src = src; this.r = reach(src);
    this.set = this.r.order.slice(0, 160); this.inSet = new Set(this.set);
    this.edges = edges.filter(e => this.inSet.has(e.A) && this.inSet.has(e.B));
    this.HOP = 1300; this.lead = 700; this.dur = this.lead + this.r.max * this.HOP + 1400;
    this.t = 0; this.playing = false; this.onTick = null;
    const xs = this.set.map(n => n.mx), ys = this.set.map(n => n.my);
    this.bb = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
    this.chapters = [{ t: 0, label: `${src.t} changes` }];
    for (let h = 1; h <= this.r.max; h++) {
      const n = this.set.filter(x => this.r.hop.get(x) === h).length;
      this.chapters.push({ t: this.lead + (h - 1) * this.HOP, label: `Hop ${h} · ${n} ${n === 1 ? 'concept' : 'concepts'} reached` });
    }
  }
  size() { const r = this.c.getBoundingClientRect(); const d = Math.min(2, devicePixelRatio || 1); this.c.width = Math.round(r.width * d); this.c.height = Math.round(r.height * d); this.d = d; this.w = r.width; this.h = r.height; }
  chapterAt(t) { let c = this.chapters[0]; for (const x of this.chapters) if (x.t <= t) c = x; return c; }
  draw(t = this.t) {
    const { g, w, h } = this; if (!w) return;
    g.setTransform(this.d, 0, 0, this.d, 0, 0);
    g.fillStyle = '#0c0c0c'; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.025)'; g.lineWidth = 1;
    for (let x = 0; x < w; x += 24) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke(); }
    for (let y = 0; y < h; y += 24) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke(); }
    const pad = Math.max(28, w * 0.07), bb = this.bb;
    const k = Math.min((w - pad * 2) / Math.max(1, bb.x1 - bb.x0), (h - pad * 2 - 30) / Math.max(1, bb.y1 - bb.y0), 2.2);
    const ox = w / 2 - ((bb.x0 + bb.x1) / 2) * k, oy = (h - 30) / 2 + 6 - ((bb.y0 + bb.y1) / 2) * k;
    const X = x => x * k + ox, Y = y => y * k + oy;
    const arrive = n => { const hh = this.r.hop.get(n); return hh === 0 ? 0 : this.lead + (hh - 1) * this.HOP + this.HOP * 0.9; };
    for (const e of this.edges) {
      const on = this.r.via.get(e.B) === e || this.r.via.get(e.A) === e;
      g.strokeStyle = on && t >= Math.max(arrive(e.A), arrive(e.B)) ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.07)';
      g.lineWidth = 1; g.beginPath(); e.pm.forEach((p, i) => i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))); g.stroke();
    }
    g.save(); g.globalCompositeOperation = 'lighter';
    for (const n of this.set) {
      const hh = this.r.hop.get(n); if (hh === 0) continue;
      const u = (t - (this.lead + (hh - 1) * this.HOP)) / (this.HOP * 0.9);
      if (u <= 0 || u >= 1) continue;
      const e = this.r.via.get(n), rev = (e.A === n ? e.B : e.A) === e.B, s = ease(u);
      const p = pointOn(e.pm, rev ? 1 - s : s), q = pointOn(e.pm, rev ? 1 - Math.max(0, s - 0.3) : Math.max(0, s - 0.3));
      const grad = g.createLinearGradient(X(q.x), Y(q.y), X(p.x), Y(p.y));
      grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(1, 'rgba(255,255,255,0.9)');
      g.strokeStyle = grad; g.lineWidth = 2.4; g.beginPath(); g.moveTo(X(q.x), Y(q.y)); g.lineTo(X(p.x), Y(p.y)); g.stroke();
      const rg = g.createRadialGradient(X(p.x), Y(p.y), 0, X(p.x), Y(p.y), 10);
      rg.addColorStop(0, 'rgba(255,255,255,0.95)'); rg.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = rg; g.beginPath(); g.arc(X(p.x), Y(p.y), 10, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    g.textAlign = 'center';
    for (const n of this.set) {
      const a = arrive(n), since = t - a, reached = since >= 0;
      const x = X(n.mx), y = Y(n.my), r = n.k === 'domain' ? 8 : n.k === 'capability' ? 5 : 3;
      if (reached && since < 1200) {
        const glow = 1 - since / 1200;
        g.save(); g.globalCompositeOperation = 'lighter';
        const rg = g.createRadialGradient(x, y, r * 0.5, x, y, r + 22 * glow + 4);
        rg.addColorStop(0, `rgba(255,255,255,${0.5 * glow})`); rg.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = rg; g.beginPath(); g.arc(x, y, r + 22 * glow + 4, 0, Math.PI * 2); g.fill(); g.restore();
      }
      g.globalAlpha = reached ? 1 : 0.22;
      g.fillStyle = reached ? (n === this.src ? '#ffffff' : '#d4d4d4') : '#4a4a4a';
      if (n.k === 'element') g.fillRect(x - r, y - r, r * 2, r * 2); else { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      if (n === this.src) { g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.beginPath(); g.arc(x, y, r + 5, 0, Math.PI * 2); g.stroke(); }
      if (reached && (this.r.hop.get(n) <= 1 || this.set.length < 18) && w > 300) {
        g.font = `${n === this.src ? 600 : 500} ${w > 600 ? 12 : 10.5}px Geist, system-ui, sans-serif`;
        g.lineWidth = 3; g.strokeStyle = '#0c0c0c'; g.strokeText(n.t, x, y + r + 13);
        g.fillStyle = n === this.src ? '#ffffff' : '#d4d4d4'; g.fillText(n.t, x, y + r + 13);
      }
      g.globalAlpha = 1;
    }
    g.textAlign = 'left'; g.font = '500 10px "Geist Mono", monospace'; g.fillStyle = '#8f8f8f';
    g.fillText('IMPACT REPLAY · SAME RULE AS THE SIGNAL KERNEL', 12, 18);
    g.textAlign = 'right';
    g.fillText(`${this.set.filter(n => arrive(n) <= t).length} / ${this.set.length} REACHED`, w - 12, 18);
    g.textAlign = 'left';
  }
  seek(t) { this.t = Math.max(0, Math.min(this.dur, t)); this.draw(); this.onTick?.(); }
  play() {
    if (this.t >= this.dur) this.t = 0;
    this.playing = true; let prev = performance.now();
    const step = now => { if (!this.playing) return; this.t = Math.min(this.dur, this.t + (now - prev) * speed); prev = now; this.draw(); this.onTick?.(); if (this.t >= this.dur) { this.playing = false; this.onTick?.(); return; } requestAnimationFrame(step); };
    requestAnimationFrame(step); this.onTick?.();
  }
  pause() { this.playing = false; this.onTick?.(); }
}
const tc = ms => { const s = ms / 1000; return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`; };
const ICON = {
  play: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 2.5v11l9.5-5.5z"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>',
  prev: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3L5 8l5 5"/></svg>',
  next: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3l5 5-5 5"/></svg>',
  x: '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
  expand: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5L9 7M2.5 13.5L7 9"/></svg>',
  pulse: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="8" cy="8" r="2"/><path d="M3.8 3.8a6 6 0 0 0 0 8.4M12.2 3.8a6 6 0 0 1 0 8.4"/></svg>',
};

function mountPlayer(host, node, big) {
  host.innerHTML = `<div class="player"><canvas></canvas></div>
    <div class="strip"><button class="ctl" data-act="play" aria-label="Play replay">${ICON.play}</button>
    <div class="scrub" role="slider" tabindex="0" aria-label="Replay position"><div class="track"></div><div class="fill"></div><div class="knob"></div></div>
    <span class="count" data-tc></span></div><div class="chapter" data-ch></div>`;
  const rp = new Replay(host.querySelector('canvas'), node);
  const scrub = host.querySelector('.scrub'), fill = host.querySelector('.fill'), knob = host.querySelector('.knob'), btn = host.querySelector('[data-act=play]');
  for (const c of rp.chapters.slice(1)) { const i = document.createElement('div'); i.className = 'tick'; i.style.left = `${(c.t / rp.dur) * 100}%`; scrub.appendChild(i); }
  rp.onTick = () => {
    const f = rp.t / rp.dur; fill.style.width = `${f * 100}%`; knob.style.left = `${f * 100}%`;
    host.querySelector('[data-tc]').textContent = `${tc(rp.t)} / ${tc(rp.dur)}`;
    const ch = rp.chapterAt(rp.t); host.querySelector('[data-ch]').innerHTML = `<span class="mono">${tc(ch.t)}</span>  ${esc(ch.label)}`;
    btn.innerHTML = rp.playing ? ICON.pause : ICON.play; btn.setAttribute('aria-label', rp.playing ? 'Pause replay' : 'Play replay');
    scrub.setAttribute('aria-valuenow', Math.round(rp.t)); scrub.setAttribute('aria-valuemax', Math.round(rp.dur));
  };
  btn.onclick = () => rp.playing ? rp.pause() : rp.play();
  const seekFrom = ev => { const r = scrub.getBoundingClientRect(); rp.seek(((ev.clientX - r.left) / r.width) * rp.dur); };
  scrub.addEventListener('pointerdown', ev => { scrub.setPointerCapture(ev.pointerId); rp.pause(); seekFrom(ev); scrub.onpointermove = seekFrom; });
  scrub.addEventListener('pointerup', () => { scrub.onpointermove = null; });
  scrub.addEventListener('keydown', ev => { if (ev.key === 'ArrowRight') rp.seek(rp.t + 500); if (ev.key === 'ArrowLeft') rp.seek(rp.t - 500); if (ev.key === ' ') { ev.preventDefault(); btn.click(); } });
  const ro = new ResizeObserver(() => { rp.size(); rp.draw(); });
  ro.observe(rp.c);
  rp.size(); rp.seek(big ? 0 : rp.lead + rp.HOP * 0.95); // the thumbnail rests on the first hop, like a poster frame
  return { dispose: () => { rp.pause(); ro.disconnect(); } };
}

function mountDeck(host, dom, big) {
  const slides = deckFor(dom);
  let i = 0;
  host.innerHTML = `<div class="${big ? 'presenter' : ''}"><div class="frame slideframe"><div class="scaler"></div></div>
    <div class="strip"><button class="ctl" data-d="-1" aria-label="Previous slide">${ICON.prev}</button><div class="dots"></div><span class="count" data-c></span><button class="ctl" data-d="1" aria-label="Next slide">${ICON.next}</button></div>
    ${big ? '<div class="kbd" style="margin-top:6px">← → to move between slides</div>' : ''}</div>`;
  const frameEl = host.querySelector('.frame'), sc = host.querySelector('.scaler'), dots = host.querySelector('.dots');
  dots.innerHTML = slides.map((_, j) => `<i data-j="${j}" title="Slide ${j + 1}"></i>`).join('');
  const show = j => {
    i = (j + slides.length) % slides.length;
    sc.innerHTML = slides[i];
    host.querySelector('[data-c]').textContent = `${i + 1} / ${slides.length}`;
    dots.querySelectorAll('i').forEach((d, k) => d.classList.toggle('on', k === i));
  };
  const scale = () => { sc.style.transform = `scale(${frameEl.clientWidth / 960})`; };
  host.querySelectorAll('[data-d]').forEach(b => b.onclick = () => show(i + +b.dataset.d));
  dots.onclick = ev => { if (ev.target.dataset.j) show(+ev.target.dataset.j); };
  const key = ev => { if (ev.key === 'ArrowRight') show(i + 1); if (ev.key === 'ArrowLeft') show(i - 1); };
  if (big) addEventListener('keydown', key);
  const ro = new ResizeObserver(scale); ro.observe(frameEl);
  show(0); scale();
  return { dispose: () => { ro.disconnect(); removeEventListener('keydown', key); } };
}

function mountPage(host, n, big) {
  if (big) {
    const margin = n.notes.length
      ? n.notes.map(([to, text]) => `<div class="note"><b>→ ${esc(byId.get(to)?.t || to)}</b>${inline(text)}</div>`).join('')
      : '<div class="quiet">No relation notes on this page.</div>';
    host.innerHTML = `<div class="docwrap"><div class="paperframe-big">${renderPaper(n, false)}</div><aside class="margin"><h4>Why each relation exists</h4>${margin}</aside></div>`;
    return { dispose() {} };
  }
  host.innerHTML = `<div class="frame paperframe"><div class="scaler">${renderPaper(n)}</div></div>`;
  const frameEl = host.querySelector('.frame'), sc = host.querySelector('.scaler');
  const scale = () => { sc.style.transform = `scale(${frameEl.clientWidth / 640})`; };
  const ro = new ResizeObserver(scale); ro.observe(frameEl); scale();
  return { dispose: () => ro.disconnect() };
}

// ---------------------------------------------------------------- real source: the file, its exports, commits and tests
const CODE = (() => { try { return JSON.parse(document.getElementById('atlas-code')?.textContent || '{}'); } catch { return {}; } })();
window.__atlasCode = CODE; // the studio prints the same listing on its pages
// code-graph-rag's canonical index of this repository, joined onto the concepts
const CGR = (() => { try { return JSON.parse(document.getElementById('atlas-cgr')?.textContent || 'null'); } catch { return null; } })();
const codeEdges = (CGR?.edges || []).map(e => ({ ...e, A: byId.get(e.a), B: byId.get(e.b) })).filter(e => e.A && e.B);
let showCodeEdges = false;
window.__atlasCGR = CGR;
const readJSON = id => { try { return JSON.parse(document.getElementById(id)?.textContent || 'null'); } catch { return null; } };
// two lanes of real history, and a meaning index over pages and code
const TL = readJSON('atlas-timeline'), SEM = readJSON('atlas-semantic');
const tlByHash = new Map((TL?.commits || []).map(c => [c.h, c]));
// ---------------------------------------------------------------- semantic search over the meaning index
const semWords = q => String(q).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-/.:]/g, ' ').toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
const semStem = w => w.length > 5 ? w.replace(/(ings|ing|ions|ion|ers|er|ies|es|s|ed|ly)$/, '') : w;
function semanticSearch(q, k = 8) {
  if (!SEM) return [];
  const words = [...new Set(semWords(q))], qs = words.map(semStem); if (!qs.length) return [];
  const out = [];
  for (const n of nodes) {
    const w = SEM.concepts[n.s]?.w || {}; let score = 0; const hit = [];
    for (const t of qs) {
      let best = w[t] || 0;
      if (!best && t.length >= 4) for (const [u, v] of Object.entries(w)) if (u.startsWith(t) || t.startsWith(u)) best = Math.max(best, v * 0.7);
      if (best) { score += best * (SEM.idf[t] || 1); hit.push(words[qs.indexOf(t)]); }
    }
    if (n.t.toLowerCase().includes(q.trim().toLowerCase())) score += 3;
    if (score > 0) out.push({ n, score, hit });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}
const KW = /\b(export|default|import|from|const|let|var|function|return|if|else|for|of|in|await|async|class|new|type|interface|extends|throw|try|catch|null|undefined|true|false)\b/g;
function tint(line) {
  const i = line.search(/(^\s*(\*|\/\*\*?|\*\/)|\/\/)/);
  const code = i < 0 ? line : line.slice(0, i), note = i < 0 ? '' : line.slice(i);
  const parts = code.split(/('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/);
  const body = parts.map((p, k) => k % 2 ? `<span class="s">${esc(p)}</span>` : esc(p).replace(KW, '<span class="k">$1</span>')).join('');
  return body + (note ? `<span class="c">${esc(note)}</span>` : '');
}
function codeHtml(c, maxLines = 999) {
  let left = maxLines;
  return c.segments.map((sg, i) => {
    const ls = sg.lines.slice(0, Math.max(0, left)); left -= ls.length;
    return (i ? '<div class="gap">⋮</div>' : '') + ls.map((l, j) => `<div class="ln"><i>${sg.start + j}</i><code>${tint(l) || ' '}</code></div>`).join('');
  }).join('');
}
function semHtml(n) {
  const m = SEM?.concepts[n.s]; if (!m) return '';
  return `<div class="cgr"><h4>Close in meaning <span>${esc(m.terms.slice(0, 5).join(' · '))}</span></h4>${m.near.map(x => { const o = byId.get(x.s); if (!o) return ''; return `<div class="cg-row"><button class="lchip" data-go="${esc(o.s)}"><b class="${o.k}"></b>${esc(o.t)}</button><span class="sub">${esc(x.shared.join(', '))}${x.linked ? '' : x.code ? ' · in the code, not the vault' : ' · not related'}</span><span class="cg-n">${x.score.toFixed(2)}</span></div>`; }).join('')}</div>`;
}
function cgrHtml(n) {
  const g = CGR?.concepts[n.s]; if (!g) return '';
  const who = r => r.concept && byId.has(r.concept) ? `<button class="lchip" data-go="${esc(r.concept)}"><b class="${byId.get(r.concept).k}"></b>${esc(byId.get(r.concept).t)}</button>` : `<span class="mono">${esc(r.path)}</span>`;
  const list = (rows, empty) => rows.length ? rows.map(r => `<div class="cg-row">${who(r)}<span class="cg-n">${r.n}</span></div>`).join('') : `<div class="quiet">${empty}</div>`;
  const edgesHere = codeEdges.filter(e => e.a === n.s || e.b === n.s), undeclared = edgesHere.filter(e => !e.declared);
  return `<div class="cgr">
    <h4>Code graph <span>code-graph-rag ${esc(CGR.source.version)} · ${esc((CGR.source.commit || '').slice(0, 7))}</span></h4>
    <div class="cg-kpis"><span><b>${g.defineCount}</b> definitions</span><span><b>${g.exported}</b> exported</span><span><b>${g.calledByModules}</b> modules call it</span><span><b>${g.callsOutModules}</b> modules it calls</span><span><b>${g.testCalls}</b> calls from tests</span></div>
    ${g.defines.length ? `<div class="cg-defs">${g.defines.map(d => `<span class="ex" title="${esc(d.doc)}"><b>${d.kind === 'function' ? 'fn' : esc(d.kind)}</b>${esc(d.name)}<i>:${d.start}${d.end > d.start ? '–' + d.end : ''}</i>${d.exported ? ' ↗' : ''}</span>`).join('')}</div>` : ''}
    <div class="cg-cols"><section><h5>Called by</h5>${list(g.calledBy, 'No caller outside this file.')}</section><section><h5>Calls into</h5>${list(g.callsOut, 'Calls nothing outside this file.')}</section></div>
    ${g.testedBy.length ? `<section><h5>Exercised by tests</h5>${list(g.testedBy, '')}</section>` : ''}
    ${undeclared.length ? `<section class="cg-warn"><h5>In the code, not in the vault</h5>${undeclared.map(e => { const o = e.a === n.s ? e.B : e.A; const ev = e.evidence[0]; return `<div class="cg-row"><button class="lchip" data-go="${esc(o.s)}"><b class="${o.k}"></b>${esc(o.t)}</button><span class="sub">${e.a === n.s ? 'calls' : 'called by'}${ev ? ` · ${esc(ev.from)} → ${esc(ev.to)}${ev.line ? ` line ${ev.line}` : ''}` : ''}</span><span class="cg-n">${e.calls + e.imports}</span></div>`; }).join('')}</section>` : ''}
  </div>`;
}
function mountCode(host, n, big) {
  const c = CODE[n.s];
  if (!c) { host.innerHTML = '<div class="quiet">This concept names no implementation file.</div>'; return { dispose() {} }; }
  const via = c.file !== c.path ? `<span class="via">re-exported from <span class="mono">${esc(c.path)}</span></span>` : '';
  host.innerHTML = `<div class="codecard ${big ? 'big' : ''}">
    <header><span class="mono fpath">${esc(c.file)}</span><span class="fmeta">${c.lines} lines${c.exports.length ? ` · ${c.exports.length} export${c.exports.length === 1 ? '' : 's'}` : ''}</span>${via}</header>
    ${c.exports.length ? `<div class="exports">${c.exports.map(e => `<span class="ex"><b>${esc(e.kind === 'function' ? 'fn' : e.kind)}</b>${esc(e.name)}<i>:${e.line}</i></span>`).join('')}</div>` : ''}
    <div class="listing">${codeHtml(c, big ? 999 : 40)}</div>
    ${cgrHtml(n)}
    ${semHtml(n)}
    <div class="codefoot">
      <section><h4>Recent commits to this file</h4>${c.commits.length ? c.commits.map(k => `<div class="cm"><span class="mono">${esc(k.h)}</span><span>${esc(k.s)}</span><time>${esc(k.d)}</time></div>`).join('') : '<div class="quiet">No commits found.</div>'}</section>
      <section><h4>Tests that import it</h4>${c.tests.length ? c.tests.map(t => `<div class="mono tf">${esc(t)}</div>`).join('') : '<div class="quiet">No test imports this file directly.</div>'}</section>
    </div></div>`;
  host.querySelectorAll('[data-go]').forEach(b => b.onclick = () => goTo(byId.get(b.dataset.go)));
  return { dispose() {} };
}

function tabsFor(n) {
  const r = reach(n), t = [{ id: 'page', label: 'Page' }];
  if (CODE[n.s]) t.push({ id: 'code', label: 'Code', n: CODE[n.s].lines });
  if (n.k === 'domain') t.push({ id: 'deck', label: 'Deck', n: contents(n).filter(c => c.k === 'capability').length + 3 });
  if (r.order.length > 1) t.push({ id: 'replay', label: 'Replay', n: tc(700 + r.max * 1300 + 1400).replace(/^00:/, '') + 's' });
  return t;
}
const mountTab = (host, n, id, big) => id === 'code' ? mountCode(host, n, big) : id === 'deck' ? mountDeck(host, n, big) : id === 'replay' ? mountPlayer(host, n, big) : mountPage(host, n, big);
const tabBar = (tabs, cur) => tabs.map(t => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${t.id === cur}">${t.label}${t.n ? ` <span class="n">${t.n}</span>` : ''}</button>`).join('');

// ---------------------------------------------------------------- popover beside the node
let pop = null, popMount = null, popTab = 'page';
function select(n, tab, opts = {}) {
  selected = n; hover = null;
  if (!opts.nav) pushNav(n);
  closePop(true);
  const tabs = tabsFor(n);
  popTab = tab && tabs.some(t => t.id === tab) ? tab : n.k === 'domain' ? 'deck' : 'page';
  pop = document.createElement('div');
  pop.className = 'pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', n.t);
  const hist = touchesOf.get(n).map(i => commits[i]);
  pop.innerHTML = `<button class="close" aria-label="Close">${ICON.x}</button>
    <header><div class="kind"><b class="${n.k}"></b>${KIND[n.k]}</div><h2>${esc(n.t)}</h2>${n.p ? `<div class="path">${esc(n.p)}</div>` : ''}
    <div class="rev">${n.revs} revision${n.revs === 1 ? '' : 's'} · last <span class="mono">${esc(n.last.h)}</span> on ${esc(n.last.d)}${hist.length ? ` · ${hist.filter(c => c.w === 'build').length} build, ${hist.filter(c => c.w === 'repair').length} repair, ${hist.filter(c => c.w === 'plan').length} plan` : ''}</div></header>
    <div class="tabs" role="tablist">${tabBar(tabs, popTab)}</div><div class="tabbody" role="tabpanel"></div>
    <footer><button class="btn primary" data-act="pulse">${ICON.pulse}Send a change</button><button class="btn" data-act="focus" title="Focus (F)">Focus</button><button class="btn" data-act="path" title="Trace a path (P)">Path to…</button><span class="grow"></span><button class="btn icon" data-act="expand" aria-label="Open full view" title="Open full view (Enter)">${ICON.expand}</button></footer>`;
  stage.appendChild(pop);
  const body = pop.querySelector('.tabbody');
  popMount = mountTab(body, n, popTab, false);
  pop.querySelector('.close').onclick = () => closePop();
  pop.querySelector('.tabs').onclick = ev => {
    const b = ev.target.closest('[data-tab]'); if (!b) return;
    popTab = b.dataset.tab; pop.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b));
    popMount?.dispose(); popMount = mountTab(body, n, popTab, false);
  };
  pop.querySelector('[data-act=pulse]').onclick = () => fire(n);
  pop.querySelector('[data-act=expand]').onclick = () => openViewer(n, popTab);
  pop.querySelector('[data-act=focus]').onclick = () => setFocus(n, focusRoot === n ? (focusDepth % 3) + 1 : 1);
  pop.querySelector('[data-act=path]').onclick = () => startPathInput();
  placePop(true);
  fire(n, { strength: 0.7, cap: 40 });
  for (const f of liveHooks.select) f(n);
}
function closePop(keepSel) {
  popMount?.dispose(); popMount = null;
  pop?.remove(); pop = null;
  if (!keepSel) selected = null;
}
function placePop(first) {
  if (!pop || !selected || innerWidth <= 640) return;
  const p = spos(selected), pw = pop.offsetWidth, ph = pop.offsetHeight;
  const gap = (view === 'time' ? 4 : R(selected) * cam.k) + 18;
  const right = p.x + gap + pw <= W - 12 || p.x < W / 2;
  const minLeft = drawer && W > 900 ? (drawerEl?.offsetWidth || 344) + 12 : 12;
  const left = Math.max(minLeft, Math.min(W - pw - 12, right ? p.x + gap : p.x - gap - pw));
  const top = Math.max(12, Math.min(H - ph - 12, p.y - 64));
  pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  if (first) { pop.style.setProperty('--ox', `${right ? 0 : pw}px`); pop.style.setProperty('--oy', `${p.y - top}px`); }
}

// ---------------------------------------------------------------- full view (explicit action)
let viewer = null, viewMount = null, lastFocus = null;
function openViewer(n, tab) {
  lastFocus = document.activeElement;
  viewer = document.createElement('div');
  viewer.className = 'scrim';
  viewer.innerHTML = `<div class="viewer" role="dialog" aria-modal="true" aria-label="${esc(n.t)}"><div class="vhead"><div class="kind"><b class="${n.k}"></b>${KIND[n.k]}</div><h2>${esc(n.t)}</h2>
    <div class="tabs" role="tablist">${tabBar(tabsFor(n), tab)}</div><button class="close" aria-label="Close full view">${ICON.x}</button></div><div class="vbody"></div></div>`;
  document.body.appendChild(viewer);
  const body = viewer.querySelector('.vbody');
  viewMount = mountTab(body, n, tab, true);
  viewer.querySelector('.tabs').onclick = ev => {
    const b = ev.target.closest('[data-tab]'); if (!b) return;
    viewer.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b));
    viewMount?.dispose(); viewMount = mountTab(body, n, b.dataset.tab, true);
  };
  viewer.querySelector('.close').onclick = closeViewer;
  viewer.addEventListener('pointerdown', ev => { if (ev.target === viewer) closeViewer(); });
  viewer.querySelector('.close').focus();
}
function closeViewer() { viewMount?.dispose(); viewMount = null; viewer?.remove(); viewer = null; lastFocus?.focus?.(); }
addEventListener('keydown', ev => {
  if (ev.key !== 'Escape') return;
  if (viewer) closeViewer(); else if (tSel) closeTrace(); else if (pathSel) { pathSel = null; renderNav(); } else if (focusSet) setFocus(null); else if (pop) closePop(); else if (drawer) openDrawer(null);
});

// ---------------------------------------------------------------- find
$('#concepts').innerHTML = nodes.slice().sort((a, b) => a.t.localeCompare(b.t)).map(n => `<option value="${esc(n.t)}">${KIND[n.k]}</option>`).join('');
$('#find').addEventListener('change', ev => {
  const n = nodes.find(x => x.t.toLowerCase() === ev.target.value.trim().toLowerCase());
  if (n) { focusNode(n); select(n); ev.target.blur(); hideSem(); }
});
// typing words rather than a title ranks concepts by meaning: page text and parsed code identifiers
const semBox = document.createElement('div'); semBox.className = 'sembox'; semBox.hidden = true; document.body.appendChild(semBox);
function hideSem() { semBox.hidden = true; }
function showSem(q) {
  const r = semanticSearch(q);
  if (!r.length || q.trim().length < 3) { hideSem(); return; }
  const box = $('#find').getBoundingClientRect();
  semBox.style.left = `${Math.max(8, box.right - 380)}px`; semBox.style.top = `${box.bottom + 6}px`;
  semBox.innerHTML = `<div class="semhead">By meaning <span>pages + code-graph-rag identifiers</span></div>` + r.map(({ n, hit }, i) => `<button data-sem="${esc(n.s)}" ${i ? '' : 'class="first"'}><b class="${n.k}"></b><span><strong>${esc(n.t)}</strong><small>${esc(firstSentence(n.desc || '')).slice(0, 110)}</small><i>${hit.map(esc).join(' · ')}</i></span></button>`).join('');
  semBox.hidden = false;
  semBox.querySelectorAll('[data-sem]').forEach(b => b.onmousedown = e => { e.preventDefault(); const t = byId.get(b.dataset.sem); $('#find').value = ''; hideSem(); focusNode(t); select(t); });
}
let semTimer = 0;
$('#find').addEventListener('input', ev => { clearTimeout(semTimer); semTimer = setTimeout(() => showSem(ev.target.value), 120); });
$('#find').addEventListener('keydown', ev => { if (ev.key === 'Enter' && !semBox.hidden) { ev.preventDefault(); semBox.querySelector('[data-sem]')?.dispatchEvent(new MouseEvent('mousedown')); } if (ev.key === 'Escape') hideSem(); });
$('#find').addEventListener('blur', () => setTimeout(hideSem, 120));

// ---------------------------------------------------------------- history transport: real commits in flow time
const tl = $('#timeline'), cap = $('#caption');
const T0 = commits[0].t, T1 = commits[commits.length - 1].t;
const xOf = t => 1 + ((t - T0) / (T1 - T0)) * 98;
tl.setAttribute('aria-valuemax', commits.length);
commits.forEach(c => {
  const el = document.createElement('div');
  el.className = 't'; el.style.left = `${xOf(c.t)}%`; el.style.height = `${6 + Math.min(12, c.nodes.length * 1.4)}px`;
  el.style.setProperty('--wc', WORK[c.w].col);
  el.title = `${c.h} · ${c.d.slice(0, 10)} · ${c.s}`;
  tl.appendChild(el);
});
for (const t of [T0, (T0 + T1) / 2, T1]) {
  const l = document.createElement('div'); l.className = 'lab'; l.style.left = `${xOf(t)}%`;
  l.textContent = new Date(t).toISOString().slice(0, 10); tl.appendChild(l);
}
const ticks = [...tl.querySelectorAll('.t')];
// the code lane: commits that changed a concept's implementation file, under the axis
const codeCommits = (TL?.commits || []).filter(c => c.code.length).map(c => ({ ...c, t: +new Date(c.d), nodesC: c.code.map(s => byId.get(s)).filter(Boolean), reachN: c.reach.map(s => byId.get(s)).filter(Boolean) })).filter(c => c.t >= T0 - 864e5 && c.t <= T1 + 864e5);
const codeTicks = codeCommits.map(c => {
  const el = document.createElement('div'); el.className = 't code';
  el.style.left = `${Math.max(0, Math.min(100, xOf(c.t)))}%`; el.style.height = `${3 + Math.min(9, Math.log10(1 + c.add + c.del) * 2)}px`;
  el.title = `${c.h} · ${c.d.slice(0, 10)} · ${c.s} · +${c.add} −${c.del}`;
  tl.appendChild(el); return el;
});
// playback walks both lanes in time order
const lanes = [...commits.map((c, i) => ({ t: c.t, lane: 'm', i })), ...codeCommits.map((c, i) => ({ t: c.t, lane: 'c', i }))].sort((a, b) => a.t - b.t);
let flowAt = lanes.length - 1;
function showCodeCommit(i, { wave = true } = {}) {
  const c = codeCommits[i];
  spacetimeNow(c.t);
  codeTicks.forEach((t, j) => t.classList.toggle('cur', j === i));
  ticks.forEach(t => t.classList.remove('cur'));
  const size = `+${c.add.toLocaleString()} −${c.del.toLocaleString()} · ${c.files} file${c.files === 1 ? '' : 's'}`;
  cap.innerHTML = `<span class="ty" style="color:#d4d4d4">CODE</span><span class="h">${esc(c.h.slice(0, 7))}</span><span class="d">${esc(c.d.slice(0, 10))}</span><span class="s">${esc(c.s)}</span><span class="n">${size} · ${c.nodesC.length} concept${c.nodesC.length === 1 ? '' : 's'}${c.reachN.length ? ` · reaches ${c.reachN.length} by calls` : ''}${c.n.length ? '' : ' · no page changed'}</span>`;
  if (!wave) return;
  c.nodesC.forEach((n, k) => fire(n, { delay: Math.min(600, k * 50) / speed, strength: 0.9, cap: Math.max(6, Math.round(90 / c.nodesC.length)), work: /^fix/.test(c.s) ? 'repair' : 'build' }));
  c.reachN.forEach((n, k) => { setTimeout(() => { n.touch = 1; n.en = Math.max(n.en, 0.45); }, (500 + k * 30) / speed); });
}
function showFlow(k, opts) { flowAt = k; const f = lanes[k]; if (f.lane === 'm') showCommit(f.i, opts); else showCodeCommit(f.i, opts); }
const gapText = ms => { const h = ms / 36e5; return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(1)} h` : `${(h / 24).toFixed(1)} days`; };
let cur = commits.length - 1, playing = false, timer = null;
function spacetimeNow(t) { const st = window.__atlasStudio; if (view === 'studio' && st?.current?.kind === 'spacetime') st.setNow(t); }
function showCommit(i, { wave = true } = {}) {
  cur = i;
  const c = commits[i], wk = WORK[c.w];
  spacetimeNow(c.t);
  ticks.forEach((t, j) => { t.classList.toggle('done', j < i); t.classList.toggle('cur', j === i); t.style.background = j <= i ? WORK[commits[j].w].col : ''; t.style.opacity = j < i ? 0.55 : 1; });
  tl.setAttribute('aria-valuenow', i + 1); tl.setAttribute('aria-valuetext', `Change ${i + 1} of ${commits.length}: ${c.s}`);
  cap.innerHTML = `<span class="ty" style="color:${wk.col}">${wk.label}</span><span class="h">${esc(c.h.slice(0, 7))}</span><span class="d">${esc(c.d.slice(0, 10))}</span><span class="s">${esc(c.s)}</span><span class="n">${c.nodes.length} page${c.nodes.length === 1 ? '' : 's'}</span>${i ? `<span class="gap">+${gapText(c.t - commits[i - 1].t)} after the last</span>` : ''}<span class="n">${i + 1}/${commits.length}</span>`;
  const x = tlByHash.get(c.h);
  if (x) cap.querySelector('.n')?.insertAdjacentText('beforeend', ` · +${x.add.toLocaleString()} −${x.del.toLocaleString()}${x.code.length ? ` · code in ${x.code.length}` : ''}`);
  codeTicks.forEach(t => t.classList.remove('cur'));
  if (!wave) return;
  c.nodes.forEach((n, k) => fire(n, { delay: Math.min(900, k * 40) / speed, strength: c.nodes.length > 8 ? 0.75 : 1, cap: Math.max(8, Math.round(160 / c.nodes.length)), work: c.w }));
}
/** Flow time: the real gap between two commits sets the pause, log-scaled so days and minutes both read. */
const _dwell = i => { const gapH = i > 0 ? (commits[i].t - commits[i - 1].t) / 36e5 : 1; return Math.min(3600, Math.max(700, 700 + 820 * Math.log10(1 + gapH))) / speed; };
function setPlaying(on) {
  playing = on; clearTimeout(timer);
  $('#playIcon').innerHTML = on ? '<path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/>' : '<path d="M4 2.5v11l9.5-5.5z"/>';
  $('#play').setAttribute('aria-label', on ? 'Pause the change history' : 'Play the change history');
  if (!on) return;
  if (flowAt >= lanes.length - 1) flowAt = -1;
  const gap = k => { const h = k > 0 ? (lanes[k].t - lanes[k - 1].t) / 36e5 : 1; return Math.min(2600, Math.max(420, 420 + 700 * Math.log10(1 + h))) / speed; };
  const step = () => {
    if (!playing) return;
    if (flowAt >= lanes.length - 1) { setPlaying(false); return; }
    showFlow(flowAt + 1);
    timer = setTimeout(step, flowAt + 1 < lanes.length ? gap(flowAt + 1) : 0);
  };
  step();
}
$('#play').onclick = () => setPlaying(!playing);
document.querySelectorAll('#speed button').forEach(b => b.onclick = () => {
  speed = +b.dataset.x;
  document.querySelectorAll('#speed button').forEach(x => x.setAttribute('aria-pressed', x === b));
});
function commitAtX(clientX) {
  const r = tl.getBoundingClientRect(), f = ((clientX - r.left) / r.width) * 100;
  let best = 0, bd = Infinity; commits.forEach((c, i) => { const d = Math.abs(xOf(c.t) - f); if (d < bd) { bd = d; best = i; } });
  return best;
}
tl.addEventListener('pointerdown', ev => {
  setPlaying(false);
  const r = tl.getBoundingClientRect(), lower = ev.clientY > r.top + 13 && codeCommits.length;
  if (!lower) { const i = commitAtX(ev.clientX); showCommit(i); flowAt = lanes.findIndex(f => f.lane === 'm' && f.i === i); return; }
  const f = ((ev.clientX - r.left) / r.width) * 100; let best = 0, bd = Infinity;
  codeCommits.forEach((c, i) => { const d = Math.abs(xOf(c.t) - f); if (d < bd) { bd = d; best = i; } });
  showCodeCommit(best); flowAt = lanes.findIndex(x => x.lane === 'c' && x.i === best);
});
tl.addEventListener('keydown', ev => {
  if (ev.key === 'ArrowRight' && cur < commits.length - 1) { setPlaying(false); showCommit(cur + 1); }
  if (ev.key === 'ArrowLeft' && cur > 0) { setPlaying(false); showCommit(cur - 1); }
});


// ---------------------------------------------------------------- lenses and filters
let lens = 'structure';
const show = { domain: true, capability: true, element: true, c: true, d: true };
let focusSet = null, focusRoot = null, focusDepth = 0, pathSel = null, drawer = null;
function nodeShown(n) { return show[n.k] || n === selected; }
function edgeShown(e) { return show[e.y === 'c' ? 'c' : 'd'] && nodeShown(e.A) && nodeShown(e.B); }
const maxRevs = Math.max(...nodes.map(n => n.revs));
function lensShade(n) {
  if (lens === 'alignment') return n.align ? (n.align.after > 0 ? '#ffffff' : '#626262') : '#2e2e2e';
  if (lens === 'activity') { const v = Math.round(64 + 191 * Math.sqrt(n.revs / maxRevs)); return `rgb(${v},${v},${v})`; }
  return null;
}
function setLens(l) {
  lens = l;
  document.querySelectorAll('#lens button').forEach(b => b.setAttribute('aria-pressed', b.dataset.lens === l));
}
document.querySelectorAll('#lens button').forEach(b => b.onclick = () => setLens(b.dataset.lens));
document.querySelectorAll('#filters button').forEach(b => b.onclick = () => {
  const on = b.getAttribute('aria-pressed') !== 'true';
  show[b.dataset.f] = on; b.setAttribute('aria-pressed', on);
  if (focusRoot) setFocus(focusRoot, focusDepth, false);
});

// ---------------------------------------------------------------- focus and paths
function fitSet(set, pad = 90) {
  const list = [...set], xs = list.map(n => n.x), ys = list.map(n => n.y);
  const left = drawer && W > 900 ? (drawerEl?.offsetWidth || 344) : 0, right = pop && W > 900 ? 400 : 0;
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((W - left - right - pad * 2) / Math.max(40, x1 - x0), (H - pad * 2) / Math.max(40, y1 - y0), 2.2);
  return { k, x: left + (W - left - right) / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k };
}
function setFocus(n, depth, fly = true) {
  if (!n || !depth) { focusSet = null; focusRoot = null; focusDepth = 0; renderNav(); return; }
  const set = new Set([n]); let frontier = [n];
  for (let d = 0; d < depth; d++) {
    const next = [];
    for (const x of frontier) for (const e of incident.get(x)) {
      if (!edgeShown(e)) continue;
      const y = e.A === x ? e.B : e.A;
      if (!set.has(y)) { set.add(y); next.push(y); }
    }
    frontier = next;
  }
  focusSet = set; focusRoot = n; focusDepth = depth; renderNav();
  if (fly && view !== 'time') flyTo(fitSet(set));
}
function tracePath(a, b) {
  const prev = new Map([[a, null]]), q = [a];
  for (let i = 0; i < q.length && !prev.has(b); i++) {
    const x = q[i];
    for (const e of incident.get(x)) { if (!edgeShown(e)) continue; const y = e.A === x ? e.B : e.A; if (!prev.has(y)) { prev.set(y, e); q.push(y); } }
  }
  if (!prev.has(b)) return null;
  const list = [b], es = [];
  for (let x = b; x !== a;) { const e = prev.get(x); es.unshift(e); x = e.A === x ? e.B : e.A; list.unshift(x); }
  return { a, b, nodes: list, edges: es, set: new Set(list), eset: new Set(es) };
}
function showPath(a, b) {
  const p = tracePath(a, b);
  if (!p) { flash(`No route from ${a.t} to ${b.t} with the relations shown.`); return; }
  pathSel = p; setFocus(null); renderNav();
  if (view !== 'time') flyTo(fitSet(p.set));
  const now = performance.now(), H0 = Math.max(320, hopMs() * 1.2);
  a.en = 1; a.touch = 1;
  p.edges.forEach((e, i) => pulses.push({ e, from: p.nodes[i], to: p.nodes[i + 1], t0: now + 350 + i * H0, dur: H0 * 0.92, s: 1, rgb: '255,255,255' }));
}
function startPathInput() {
  if (!pop || !selected) return;
  const foot = pop.querySelector('footer');
  foot.innerHTML = `<input class="pathin" list="concepts" placeholder="Trace a path from ${esc(selected.t)} to…" aria-label="Destination concept" style="flex:1;min-width:0;background:var(--panel);border:1px solid var(--line-2);border-radius:7px;padding:6px 9px;font-size:12.5px"><button class="btn" data-act="cancel">Cancel</button>`;
  const inp = foot.querySelector('input'); inp.focus();
  const from = selected;
  let done = false;
  inp.addEventListener('change', () => {
    const to = nodes.find(x => x.t.toLowerCase() === inp.value.trim().toLowerCase());
    if (done || !to || to === from) return;
    done = true;
    setTimeout(() => { showPath(from, to); select(from, popTab, { nav: true }); }, 0); // leave the input's own blur first
  });
  foot.querySelector('[data-act=cancel]').onclick = () => select(from, popTab, { nav: true });
}

// ---------------------------------------------------------------- navigation: history, crumbs, keyboard
const navHist = []; let navAt = -1;
function pushNav(n) {
  if (navHist[navAt] === n) return;
  navHist.splice(navAt + 1); navHist.push(n); navAt = navHist.length - 1; renderNav();
}
function goNav(d) {
  const i = navAt + d; if (i < 0 || i >= navHist.length) return;
  navAt = i; const n = navHist[i];
  if (!nodes.includes(n)) return;
  focusNode(n); select(n, undefined, { nav: true }); renderNav();
}
const ICON_BACK = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 3L5 8l5 5"/></svg>';
const ICON_FWD = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3l5 5-5 5"/></svg>';
function renderNav() {
  const el = $('#nav');
  const from = Math.max(0, navAt - 3), crumbs = navHist.slice(from, navAt + 1);
  let html = `<button class="iconbtn" data-nav="-1" aria-label="Back" ${navAt > 0 ? '' : 'disabled'}>${ICON_BACK}</button><button class="iconbtn" data-nav="1" aria-label="Forward" ${navAt < navHist.length - 1 ? '' : 'disabled'}>${ICON_FWD}</button>`;
  if (crumbs.length) html += `<div class="crumbs">${crumbs.map((n, i) => `${i ? '<span class="sep">/</span>' : ''}<button data-crumb="${from + i}" aria-current="${from + i === navAt}">${esc(n.t)}</button>`).join('')}</div>`;
  if (focusSet) html += `<span class="chipx">Focus <b>${esc(focusRoot.t)}</b><span class="mono" style="font-size:11px">${focusSet.size}</span>${[1, 2, 3].map(d => `<button data-depth="${d}" aria-pressed="${d === focusDepth}" aria-label="Depth ${d}">${d}</button>`).join('')}<button data-clear="focus">Clear</button></span>`;
  if (pathSel) html += `<span class="chipx">Path <b>${esc(pathSel.a.t)} → ${esc(pathSel.b.t)}</b><span class="mono" style="font-size:11px">${pathSel.edges.length} hop${pathSel.edges.length === 1 ? '' : 's'}</span><button data-clear="path">Clear</button></span>`;
  el.innerHTML = html;
}
$('#nav').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.nav) goNav(+b.dataset.nav);
  else if (b.dataset.crumb) { navAt = +b.dataset.crumb; const n = navHist[navAt]; focusNode(n); select(n, undefined, { nav: true }); renderNav(); }
  else if (b.dataset.depth) setFocus(focusRoot, +b.dataset.depth);
  else if (b.dataset.clear === 'focus') setFocus(null);
  else if (b.dataset.clear === 'path') { pathSel = null; renderNav(); }
});
function stepFrom(from, dx, dy) {
  const p0 = spos(from);
  const score = n => { const p = spos(n), vx = p.x - p0.x, vy = p.y - p0.y, along = vx * dx + vy * dy; if (along <= 4) return Infinity; return along + Math.abs(vx * dy - vy * dx) * 2.2; };
  for (const pool of [[...neighbours(from)], nodes]) {
    let best = null, bs = Infinity;
    for (const n of pool) { if (n === from || !nodeShown(n) || (focusSet && !focusSet.has(n))) continue; const sc = score(n); if (sc < bs) { bs = sc; best = n; } }
    if (best) return best;
  }
  return null;
}
function keepInView(n) { const p = spos(n); if (view !== 'time' && (p.x < 60 || p.x > W - (W > 900 ? 440 : 60) || p.y < 70 || p.y > H - 60)) focusNode(n); }
addEventListener('keydown', ev => {
  if (viewer || ev.metaKey || ev.ctrlKey || ev.altKey || ev.target.closest('input, textarea, select')) return;
  if (ev.key === '/') { ev.preventDefault(); $('#find').focus(); return; }
  if (ev.key === '[') { goNav(-1); return; }
  if (ev.key === ']') { goNav(1); return; }
  const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[ev.key];
  if (dir && (ev.target.closest('.scrub, .timeline') || view === 'trace' || view === 'studio')) return;
  if (dir) {
    ev.preventDefault();
    const n = selected ? stepFrom(selected, ...dir) : nodes.filter(nodeShown).sort((a, b) => { const pa = spos(a), pb = spos(b); return Math.hypot(pa.x - W / 2, pa.y - H / 2) - Math.hypot(pb.x - W / 2, pb.y - H / 2); })[0];
    if (n) { select(n, popTab); keepInView(n); }
    return;
  }
  if (!selected) return;
  if (ev.key === 'Enter' && !ev.target.closest('button')) openViewer(selected, popTab);
  else if (ev.key === 'f' || ev.key === 'F') setFocus(selected, focusRoot === selected ? (focusDepth % 3) + 1 : 1);
  else if (ev.key === 'p' || ev.key === 'P') { ev.preventDefault(); startPathInput(); }
});
let flashTimer = 0;
function flash(text) {
  const h = $('#hint'); const prev = h.dataset.base ?? h.textContent; h.dataset.base = prev;
  h.textContent = text; h.style.color = 'var(--t1)'; clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { h.textContent = h.dataset.base; h.style.color = ''; delete h.dataset.base; }, 3200);
}

// ---------------------------------------------------------------- minimap
const mini = $('#mini'), mctx = mini.getContext('2d');
let miniBox = null;
function drawMini() {
  const hide = view === 'time' || view === 'trace' || W < 760;
  if (mini.hidden !== hide) mini.hidden = hide;
  if (hide) return;
  const d = Math.min(2, devicePixelRatio || 1), mw = 184, mh = 116;
  if (mini.width !== mw * d) { mini.width = mw * d; mini.height = mh * d; }
  const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const k = Math.min((mw - 16) / (x1 - x0), (mh - 16) / (y1 - y0));
  const ox = mw / 2 - ((x0 + x1) / 2) * k, oy = mh / 2 - ((y0 + y1) / 2) * k;
  miniBox = { k, ox, oy };
  mctx.setTransform(d, 0, 0, d, 0, 0); mctx.clearRect(0, 0, mw, mh);
  for (const n of nodes) {
    if (!nodeShown(n)) continue;
    const inF = !focusSet || focusSet.has(n);
    mctx.fillStyle = n === selected ? '#ffffff' : n.en > 0.2 ? '#e0e0e0' : inF ? (n.k === 'element' ? '#4a4a4a' : '#8f8f8f') : '#262626';
    const r = n.k === 'domain' ? 2.2 : n.k === 'capability' ? 1.5 : 0.9;
    mctx.fillRect(n.x * k + ox - r, n.y * k + oy - r, r * 2, r * 2);
  }
  const vx0 = (-cam.x / cam.k) * k + ox, vy0 = (-cam.y / cam.k) * k + oy, vw = (W / cam.k) * k, vh = (H / cam.k) * k;
  mctx.strokeStyle = 'rgba(255,255,255,0.7)'; mctx.lineWidth = 1; mctx.strokeRect(vx0 + 0.5, vy0 + 0.5, vw, vh);
  mctx.fillStyle = 'rgba(255,255,255,0.04)'; mctx.fillRect(vx0, vy0, vw, vh);
}
function miniJump(ev) {
  if (!miniBox) return;
  const r = mini.getBoundingClientRect(), wx = (ev.clientX - r.left - miniBox.ox) / miniBox.k, wy = (ev.clientY - r.top - miniBox.oy) / miniBox.k;
  camAnim = null; cam.x = W / 2 - wx * cam.k; cam.y = H / 2 - wy * cam.k;
}
mini.addEventListener('pointerdown', ev => { mini.setPointerCapture(ev.pointerId); miniJump(ev); mini.onpointermove = miniJump; });
mini.addEventListener('pointerup', () => { mini.onpointermove = null; });

// ---------------------------------------------------------------- hover preview
const tip = $('#tip'); let tipFor = null, tipTimer = 0, tipOn = false;
function tipFrame() {
  if (hover !== tipFor) {
    tipFor = hover; clearTimeout(tipTimer); tip.hidden = true; tipOn = false;
    if (hover && hover !== selected && !drag) tipTimer = setTimeout(() => {
      const n = tipFor; if (!n) return;
      const a = n.align ? (n.align.after > 0 ? `code moved ${n.align.after} commit${n.align.after === 1 ? '' : 's'} after this page` : 'page current with its code') : 'no implementation path';
      tip.innerHTML = `<div class="k">${KIND[n.k]} · ${n.revs} rev</div><b>${esc(n.t)}</b>${esc(firstSentence(n.doc.desc || '')).slice(0, 180)}<div class="a">${a} · reaches ${reach(n).order.length - 1}</div>`;
      tip.hidden = false; tipOn = true;
    }, 220);
  }
  if (tipOn && tipFor) {
    const p = spos(tipFor), tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(W - tw - 8, p.x + 16)}px`; tip.style.top = `${Math.min(H - th - 8, p.y + 14)}px`;
  }
}

// ---------------------------------------------------------------- drawers
const ICON_CLOSE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
let drawerEl = null;
function openDrawer(kind) {
  if (drawer === kind) kind = null;
  drawerEl?.remove(); drawerEl = null; drawer = kind;
  document.querySelectorAll('#tools button').forEach(b => b.setAttribute('aria-pressed', b.dataset.drawer === kind));
  stage.classList.toggle('has-drawer', !!kind);
  if (!kind) return;
  drawerEl = document.createElement('aside');
  drawerEl.className = 'drawer';
  stage.appendChild(drawerEl);
  if (kind === 'review') { renderReview(); setLens('alignment'); }
  else if (kind === 'decide') { drawerEl.classList.add('wide'); renderDecide(); }
  else if (kind === 'sources') { drawerEl.classList.add('wide'); renderSources(); }
  else if (kind === 'live') { drawerEl.classList.add('wide'); for (const f of liveHooks.drawer) f(drawerEl, () => openDrawer(null)); }
  else renderBuild();
}
document.querySelectorAll('#tools button').forEach(b => b.onclick = () => openDrawer(b.dataset.drawer));
function goTo(n) { if (view === 'time') setView('map'); focusNode(n); select(n); }
// ---------------------------------------------------------------- live layer hooks
// The live layer (people, channels, agents) lives in its own script; it reads the graph through
// this handle and never reaches into the renderer's state directly.
const liveHooks = { select: [], overlay: [], drawer: [] };
window.__atlas = {
  nodes, edges, byId, reach, domainOf, contents, containers, dependsOn, goTo, fire, flash, esc,
  path: (a, b) => tracePath(a, b), hooks: liveHooks, cgr: CGR, codeEdges, semanticSearch, sem: SEM, timeline: TL,
  get selected() { return selected; }, get view() { return view; }, get drawer() { return drawer; },
  openLive: () => { if (drawer !== 'live') openDrawer('live'); },
};
window.dispatchEvent(new Event('atlas-ready'));

function renderReview() {
  const withPath = nodes.filter(n => n.align && !n.draft), exist = withPath.filter(n => n.align.exists);
  const drift = withPath.filter(n => n.align.after > 0).sort((a, b) => b.align.after - a.align.after);
  const openQ = nodes.reduce((s, n) => s + (n.draft ? 0 : n.uncertain), 0);
  const unc = nodes.filter(n => !n.draft && n.uncertain).sort((a, b) => b.uncertain - a.uncertain).slice(0, 6);
  const maxU = Math.max(1, ...unc.map(n => n.uncertain));
  const noted = nodes.filter(n => n.notes.length).length;
  const quiet = nodes.filter(n => !n.draft && n.k === 'capability').sort((a, b) => a.last.d.localeCompare(b.last.d)).slice(0, 4);
  drawerEl.innerHTML = `<header><div class="kind">Review</div><h2>Code against meaning</h2><p>Every figure is read from this repository's Git history and vault pages.</p><button class="close" aria-label="Close review">${ICON_CLOSE}</button></header>
  <div class="dbody">
    <div class="kpis">
      <div class="kpi"><b>${withPath.length}</b><span>pages name an implementation path</span></div>
      <div class="kpi"><b>${exist.length}</b><span>of those paths exist on main</span></div>
      <div class="kpi"><b>${drift.length}</b><span>pages behind their code</span></div>
      <div class="kpi"><b>${openQ}</b><span>open questions across ${nodes.filter(n => n.uncertain).length} pages</span></div>
    </div>
    <div class="dsec"><h3>Pages behind their code</h3><p class="m">Commits on main that touched the implementation after the page's own last commit.</p>
      <div class="rows">${drift.length ? drift.map(n => `<button class="row" data-go="${esc(n.s)}"><b>${esc(n.t)}</b><span class="v">+${n.align.after} commit${n.align.after === 1 ? '' : 's'}</span><span class="sub">${esc(n.p)} · code ${esc(n.align.code?.d.slice(0, 10) || '')} · page ${esc(n.align.page.slice(0, 10))}</span><span class="sub">${esc(n.align.code?.s || '')}</span></button>`).join('') : '<p class="m">Every page is current with its code.</p>'}</div></div>
    ${CGR ? `<div class="dsec"><h3>Code graph against the vault</h3><p class="m">code-graph-rag ${esc(CGR.source.version)} parsed this repository at ${esc((CGR.source.commit || '').slice(0, 7))}: ${CGR.source.nodes.toLocaleString()} nodes, ${CGR.source.relationships.toLocaleString()} relationships, ${CGR.source.modules.toLocaleString()} modules. ${Object.keys(CGR.concepts).length} concepts resolve to a parsed module.</p>
      <div id="conn" class="conn"></div>
      <label class="lfollow" style="margin:0 0 8px"><input type="checkbox" id="codeedges" ${showCodeEdges ? 'checked' : ''}> Draw code edges on the map (dashed: not declared in the vault)</label>
      <div class="kpis" style="margin-bottom:10px"><div class="kpi"><b>${codeEdges.filter(e => !e.declared).length}</b><span>code edges between concepts the vault does not declare</span></div><div class="kpi"><b>${CGR.unverified.length}</b><span>declared dependencies with no call or import in the code</span></div></div>
      <div class="rows">${codeEdges.filter(e => !e.declared).slice(0, 8).map(e => `<button class="row" data-path="${esc(e.a)}|${esc(e.b)}"><b>${esc(e.A.t)} → ${esc(e.B.t)}</b><span class="v">${e.calls + e.imports}</span><span class="sub">${e.evidence[0] ? `${esc(e.evidence[0].from)} calls ${esc(e.evidence[0].to)}${e.evidence[0].line ? ` at line ${e.evidence[0].line}` : ''}` : `${e.imports} import${e.imports === 1 ? '' : 's'}`}</span></button>`).join('')}</div>
      ${CGR.unverified.length ? `<p class="m" style="margin-top:10px">Declared but not seen in code:</p><div class="rows">${CGR.unverified.slice(0, 5).map(u => `<button class="row" data-path="${esc(u.a)}|${esc(u.b)}"><b>${esc(byId.get(u.a)?.t || u.a)} → ${esc(byId.get(u.b)?.t || u.b)}</b><span class="v">0</span></button>`).join('')}</div>` : ''}
    </div>` : ''}
    ${SEM ? `<div class="dsec"><h3>Suggested relations</h3><p class="m">Pairs whose pages and code share the most distinctive vocabulary (TF-IDF over ${SEM.source.docs} pages and code-graph-rag identifiers) but that the vault does not relate. Marked pairs are also connected in the code.</p>
      <div class="rows">${SEM.suggestions.slice(0, 10).map(x => { const a = byId.get(x.a), b = byId.get(x.b); return a && b ? `<button class="row" data-path="${esc(x.a)}|${esc(x.b)}"><b>${esc(a.t)} ↔ ${esc(b.t)}</b><span class="v">${x.score.toFixed(2)}${x.code ? ' · code' : ''}</span><span class="sub">shared: ${esc(x.shared.join(', '))}</span></button>` : ''; }).join('')}</div></div>` : ''}
    ${TL ? `<div class="dsec"><h3>Code moving without meaning</h3><p class="m">Since ${esc(TL.since.slice(0, 10))}: ${TL.commits.length} commits touched a concept's page or code; ${TL.commits.filter(c => c.code.length && !c.n.length).length} changed code without touching any page. Concepts with the most such commits:</p>
      <div class="rows">${(() => { const k = new Map(); for (const c of TL.commits) if (!c.n.length) for (const s of c.code) k.set(s, (k.get(s) || 0) + 1); const mx = Math.max(1, ...k.values()); return [...k].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, v]) => byId.get(s) ? `<button class="row" data-go="${esc(s)}"><b>${esc(byId.get(s).t)}</b><span class="v">${v}</span><span class="bar1"><i style="width:${(v / mx) * 100}%"></i></span></button>` : '').join(''); })()}</div></div>` : ''}
    <div class="dsec"><h3>Most open questions</h3><p class="m">Items in each page's Uncertainty section: what the author could not confirm from the source.</p>
      <div class="rows">${unc.map(n => `<button class="row" data-go="${esc(n.s)}"><b>${esc(n.t)}</b><span class="v">${n.uncertain}</span><span class="bar1"><i style="width:${(n.uncertain / maxU) * 100}%"></i></span></button>`).join('')}</div></div>
    <div class="dsec"><h3>Longest since reviewed</h3><p class="m">Capabilities whose page has gone longest without a commit.</p>
      <div class="rows">${quiet.map(n => `<button class="row" data-go="${esc(n.s)}"><b>${esc(n.t)}</b><span class="v">${esc(n.last.d)}</span></button>`).join('')}</div></div>
    <div class="dsec"><h3>Reasons on record</h3><p class="m">${noted} pages explain at least one relation in words (relation notes), ${nodes.reduce((s, n) => s + n.notes.length, 0)} notes in all. The map lens is set to Alignment while this panel is open: behind-code pages draw white with a broken ring.</p></div>
  </div>`;
  drawerEl.querySelector('.close').onclick = () => openDrawer(null);
  drawerEl.querySelectorAll('[data-go]').forEach(b => b.onclick = () => goTo(byId.get(b.dataset.go)));
  drawerEl.querySelector('#codeedges')?.addEventListener('change', ev => { showCodeEdges = ev.target.checked; });
  const connEl = drawerEl.querySelector('#conn'); if (connEl) window.__atlasConn?.mount(connEl);
  drawerEl.querySelectorAll('[data-path]').forEach(b => b.onclick = () => { const [a, c] = b.dataset.path.split('|').map(x => byId.get(x)); if (a && c) { if (view === 'time' || view === 'trace' || view === 'studio') setView('map'); showCodeEdges = true; const box = drawerEl.querySelector('#codeedges'); if (box) box.checked = true; focusSet = new Set([a, c]); focusRoot = a; focusDepth = 1; fitSet(focusSet); select(a); fire(a, { cap: 30 }); } });
}

// ---------------------------------------------------------------- build: draft a capability, see its reach, export the page
const slugify = t => t.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'untitled';
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
const has = s => byId.has(s) && !byId.get(s).draft;
let form = {
  uid: uuid(), example: true,
  title: 'Alignment review queue',
  summary: 'Lists the concepts whose implementation changed after their page was last written, so a person can re-read the source and confirm or correct the recorded meaning.',
  includes: 'A queue of pages whose code moved after the page\nA side-by-side read of the page and the changed source',
  domain: has('domains/meaning-layer') ? 'domains/meaning-layer' : domains[0].s,
  path: 'src/views/ontology-insights/lib/alignment-queue.ts',
  elements: [],
  deps: ['capabilities/evidence-drift-detection', 'capabilities/vault-git-history', 'capabilities/ontology-insights'].filter(has),
};
let draft = null;
function draftBody(f) {
  const inc = f.includes.split('\n').map(x => x.trim()).filter(Boolean);
  return `${f.summary.trim() || 'What this capability lets a person or agent do, in one sentence.'}\n\n## Includes\n${(inc.length ? inc : ['To be named in review.']).map(x => `- ${x}`).join('\n')}\n\n## Excludes\n- To be decided in review.\n\n## Uncertainty\n- Drafted in Atlas Current and not yet read against the source${f.path.trim() ? ` at \`${f.path.trim()}\`` : ''}.`;
}
function removeDraft() {
  if (!draft) return;
  for (const e of draft.edges) { for (const n of [e.A, e.B]) { const l = incident.get(n); if (l) l.splice(l.indexOf(e), 1); } edges.splice(edges.indexOf(e), 1); }
  nodes.splice(nodes.indexOf(draft.node), 1); incident.delete(draft.node); byId.delete(draft.node.s);
  if (selected === draft.node) closePop();
  if (focusSet?.has(draft.node)) setFocus(null);
  if (pathSel?.set.has(draft.node)) pathSel = null;
  draft = null;
}
function applyDraft() {
  removeDraft();
  const f = form; if (!f.title.trim()) return;
  const dom = byId.get(f.domain), els = f.elements.map(x => byId.get(x)).filter(Boolean), deps = f.deps.map(x => byId.get(x)).filter(Boolean);
  let slug = 'capabilities/' + slugify(f.title);
  if (byId.has(slug)) slug += '-draft';
  const node = { s: slug, k: 'capability', t: f.title.trim(), p: f.path.trim() || null, by: 'human', uid: f.uid, body: draftBody(f), notes: [], last: { h: 'draft', d: 'not committed', s: '' }, revs: 0, file: `docs/ontology/${slug}.md`, align: null, uncertain: 1, relCount: deps.length, en: 0, touch: 0, draft: true };
  node.doc = parseBody(node.body);
  const pool = els.length ? els : [dom];
  node.mx = pool.reduce((a, x) => a + x.mx, 0) / pool.length + (els.length ? 0 : 80);
  node.my = pool.reduce((a, x) => a + x.my, 0) / pool.length + (els.length ? -50 : 60);
  node.tx = els.length ? els.reduce((a, x) => a + x.tx, 0) / els.length : dom.tx + 70; node.ty = TIER.capability;
  node.x = view === 'tiers' ? node.tx : node.mx; node.y = view === 'tiers' ? node.ty : node.my;
  nodes.push(node); byId.set(slug, node); incident.set(node, []); touchesOf.set(node, []);
  const mk = (A, B, y) => {
    const e = { a: A.s, b: B.s, y, A, B, en: 0, draft: true, h: hashOf(A.s + B.s) };
    e.bend = y === 'd' ? 0.2 : 0.08; e.phase = (e.h % 997) / 997;
    e.pm = curvePts({ x: A.mx, y: A.my }, { x: B.mx, y: B.my }, e.bend);
    const lane = y === 'c' && A.k === 'domain' ? TIER.capability - 96 - domIndex.get(A) * 11 : y === 'c' ? TIER.element - 92 : TIER.capability - 36 - (e.h % 5) * 8;
    e.pt = orthoPts([{ x: A.tx, y: A.ty }, { x: A.tx, y: lane }, { x: B.tx, y: lane }, { x: B.tx, y: B.ty }]);
    e.P = view === 'tiers' ? e.pt : e.pm;
    edges.push(e); incident.get(A).push(e); incident.get(B).push(e);
    return e;
  };
  draft = { node, edges: [mk(dom, node, 'c'), ...els.map(x => mk(node, x, 'c')), ...deps.map(x => mk(node, x, 'd'))] };
}
function pageMarkdown() {
  const f = form, n = draft?.node; if (!n) return '';
  const list = a => `[${a.join(', ')}]`;
  return `---\nuid: ${f.uid}\nslug: ${n.s}\nkind: capability\ntitle: ${JSON.stringify(n.t)}\ndisplay_en: ${JSON.stringify(n.t)}\ndomain: ${f.domain}\nelements: ${list(f.elements)}\n${n.p ? `path: ${n.p}\n` : ''}created_by: "human"\ndependencies: ${list(f.deps)}\nrelates: []\n---\n\n${n.body}\n`;
}
function renderBuild() {
  const caps = nodes.filter(n => n.k === 'capability' && !n.draft).sort((a, b) => a.t.localeCompare(b.t));
  const els = nodes.filter(n => n.k === 'element' && domainOf(n)?.s === form.domain).sort((a, b) => a.t.localeCompare(b.t));
  drawerEl.innerHTML = `<header><div class="kind">Build ${form.example ? '<span class="example">Example draft</span>' : ''}</div><h2>Draft a capability</h2><p>Shape it here, watch where a change would travel, then copy the page. Nothing is written to the vault.</p><button class="close" aria-label="Close build">${ICON_CLOSE}</button></header>
  <div class="dbody">
    <label class="field"><span>Title</span><input id="b-title" value="${esc(form.title)}"></label>
    <label class="field"><span>What it lets someone do</span><textarea id="b-summary">${esc(form.summary)}</textarea></label>
    <label class="field"><span>Includes, one per line</span><textarea id="b-includes">${esc(form.includes)}</textarea></label>
    <label class="field"><span>Domain</span><select id="b-domain">${domains.map(d => `<option value="${esc(d.s)}" ${d.s === form.domain ? 'selected' : ''}>${esc(d.t)}</option>`).join('')}</select></label>
    <label class="field"><span>Implementation entry point</span><input id="b-path" class="mono" style="font-family:var(--mono);font-size:12px" value="${esc(form.path)}"></label>
    <div class="field"><span>Elements it holds · ${esc(byId.get(form.domain)?.t || '')}</span><div class="checks" id="b-els">${els.map(n => `<label><input type="checkbox" value="${esc(n.s)}" ${form.elements.includes(n.s) ? 'checked' : ''}>${esc(n.t)}</label>`).join('') || '<span class="m">No elements in this domain.</span>'}</div></div>
    <div class="field"><span>Depends on</span><div class="checks" id="b-deps">${caps.map(n => `<label><input type="checkbox" value="${esc(n.s)}" ${form.deps.includes(n.s) ? 'checked' : ''}>${esc(n.t)}</label>`).join('')}</div></div>
    <div class="dsec"><h3>Checks</h3><div class="verdicts" id="b-checks"></div></div>
    <div class="dsec"><h3>Reach</h3><div class="impact" id="b-impact"></div></div>
    <div class="dsec"><h3>Page preview</h3><div class="frame paperframe" id="b-paper" style="height:250px"><div class="scaler"></div></div></div>
    <div class="actions"><button class="btn primary" data-b="show">Show on map</button><button class="btn" data-b="pulse">Send a change</button><button class="btn" data-b="copy">Copy page</button><button class="btn" data-b="discard">Discard</button></div>
    <div id="b-export"></div>
  </div>`;
  drawerEl.querySelector('.close').onclick = () => openDrawer(null);
  const read = () => {
    form.title = $('#b-title').value; form.summary = $('#b-summary').value; form.includes = $('#b-includes').value;
    form.path = $('#b-path').value; form.example = false;
    form.elements = [...drawerEl.querySelectorAll('#b-els input:checked')].map(i => i.value);
    form.deps = [...drawerEl.querySelectorAll('#b-deps input:checked')].map(i => i.value);
  };
  drawerEl.addEventListener('input', ev => {
    if (ev.target.id === 'b-domain') { read(); form.domain = ev.target.value; form.elements = []; applyDraft(); renderBuild(); return; }
    read(); applyDraft(); refreshBuild();
    drawerEl.querySelector('.example')?.remove();
  });
  drawerEl.querySelector('[data-b=show]').onclick = () => { if (draft) { goTo(draft.node); setFocus(draft.node, 1); } };
  drawerEl.querySelector('[data-b=pulse]').onclick = () => { if (draft) fire(draft.node); };
  drawerEl.querySelector('[data-b=discard]').onclick = () => { removeDraft(); form = { ...form, uid: uuid(), title: '', summary: '', includes: '', path: '', elements: [], deps: [], example: false }; renderBuild(); };
  drawerEl.querySelector('[data-b=copy]').onclick = async () => {
    const md = pageMarkdown(); if (!md) return;
    try { await navigator.clipboard.writeText(md); flash(`Copied ${draft.node.file}. It lands through add_concept after review.`); }
    catch { const box = $('#b-export'); box.innerHTML = `<textarea class="exported" readonly aria-label="Page Markdown">${esc(md)}</textarea>`; const ta = box.querySelector('textarea'); ta.focus(); ta.select(); flash('Clipboard unavailable here; the page text is selected below.'); }
  };
  if (!draft) applyDraft();
  refreshBuild();
}
function refreshBuild() {
  if (!drawerEl || drawer !== 'build') return;
  const n = draft?.node;
  const ok = (c, yes, no) => `<span class="${c ? '' : 'no'}"><i>${c ? '✓' : '·'}</i>${c ? yes : no}</span>`;
  const slugFree = n && !has(n.s);
  $('#b-checks').innerHTML = [
    ok(!!n, 'Has a title', 'Needs a title'),
    ok(!!form.domain, 'Belongs to a domain', 'Needs a domain'),
    ok(!!form.path.trim(), 'Names one implementation entry point', 'No implementation path yet'),
    ok(form.elements.length > 0, `Holds ${form.elements.length} element${form.elements.length === 1 ? '' : 's'}`, 'Holds no elements yet'),
    ok(!!slugFree, `Slug ${n ? esc(n.s) : ''} is free`, 'Slug is taken'),
    ok(true, 'UID is minted once and never changes', ''),
  ].join('');
  if (!n) { $('#b-impact').textContent = 'Give it a title to place it on the map.'; $('#b-paper .scaler').innerHTML = ''; return; }
  const r = reach(n), byKind = k => r.order.filter(x => x !== n && x.k === k).length;
  const users = incident.get(n).filter(e => e.y === 'd' && e.B === n).length;
  // upstream: everything whose change would arrive here (its dependencies and containers, transitively)
  const up = new Set([n]), q = [n];
  for (let i = 0; i < q.length; i++) for (const e of incident.get(q[i])) {
    const x = e.y === 'd' && e.A === q[i] ? e.B : e.y === 'c' && e.B === q[i] ? e.A : null;
    if (x && !up.has(x)) { up.add(x); q.push(x); }
  }
  $('#b-impact').innerHTML = `A change here would reach <b>${r.order.length - 1}</b> concept${r.order.length === 2 ? '' : 's'} in <b>${r.max}</b> hop${r.max === 1 ? '' : 's'}: ${byKind('capability')} capabilities, ${byKind('element')} elements. It depends on <b>${form.deps.length}</b>; <b>${users}</b> depend on it. Upstream, a change in any of <b>${up.size - 1}</b> concepts would arrive here.`;
  const frame = $('#b-paper'), sc = frame.querySelector('.scaler');
  sc.innerHTML = renderPaper(n); sc.style.transform = `scale(${frame.clientWidth / 640})`;
}


// ---------------------------------------------------------------- trace: routes → code → contracts → meaning
const T = JSON.parse(document.getElementById('trace-data').textContent);
const COLS = [
  { key: 'decision', title: 'Decisions' },
  { key: 'route', title: 'Routes' },
  { key: 'view', title: 'Views' },
  { key: 'widget', title: 'Widgets' },
  { key: 'feature', title: 'Features' },
  { key: 'entity', title: 'Entities' },
  { key: 'intent', title: 'Intents · prompts', also: ['prompt'] },
  { key: 'desktop', title: 'Desktop · JSONL', also: ['jsonl'] },
  { key: 'mcp', title: 'MCP tools' },
  { key: 'meaning', title: 'Meaning' },
];
const TKIND = { route: 'Route', view: 'View', widget: 'Widget', feature: 'Feature', entity: 'Entity', intent: 'Intent', prompt: 'Prompt', desktop: 'Desktop command', jsonl: 'JSONL log', mcp: 'MCP tool', meaning: 'Capability', decision: 'Decision' };
const colOf = k => COLS.findIndex(c => c.key === k || c.also?.includes(k));
const tn = T.nodes.map(n => ({ ...n, col: colOf(n.kind), en: 0 })).filter(n => n.col >= 0);
const tById = new Map(tn.map(n => [n.id, n]));
const te = T.edges.map(e => ({ A: tById.get(e.a), B: tById.get(e.b), en: 0 })).filter(e => e.A && e.B);
const tOut = new Map(tn.map(n => [n, []])), tIn = new Map(tn.map(n => [n, []]));
for (const e of te) { tOut.get(e.A).push(e); tIn.get(e.B).push(e); }
const COLW = 250, ROWH = 22;
const byCol = COLS.map((_, i) => tn.filter(n => n.col === i));
byCol.forEach(list => list.sort((a, b) => a.label.localeCompare(b.label)).forEach((n, i) => { n.row = i; }));
{ // barycentre sweeps: order each column by where its neighbours sit, to cut crossings
  const nb = n => [...tOut.get(n).map(e => e.B), ...tIn.get(n).map(e => e.A)].filter(m => m.col !== n.col);
  const pos = m => m.row / Math.max(1, byCol[m.col].length - 1);
  for (let it = 0; it < 10; it++) for (const list of (it % 2 ? [...byCol].reverse() : byCol)) {
    for (const n of list) { const ns = nb(n); n.bc = ns.length ? ns.reduce((a, m) => a + pos(m), 0) / ns.length : pos(n); }
    list.sort((a, b) => a.bc - b.bc).forEach((n, i) => { n.row = i; });
  }
}
const tallest = Math.max(...byCol.map(l => l.length));
for (const n of tn) { n.x = n.col * COLW; n.y = (n.row - (byCol[n.col].length - 1) / 2) * ROWH; }
function traceFit() {
  const x0 = -150, x1 = (COLS.length - 1) * COLW + 190, y0 = -(tallest * ROWH) / 2 - 50, y1 = (tallest * ROWH) / 2 + 10;
  const k = Math.min((W - 60) / (x1 - x0), (H - 70) / (y1 - y0), 1.4);
  return { k, x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 + 14 - ((y0 + y1) / 2) * k };
}
function flow(start, dir) {
  const seen = new Map([[start, 0]]), q = [start];
  for (let i = 0; i < q.length; i++) for (const e of (dir > 0 ? tOut : tIn).get(q[i])) { const m = dir > 0 ? e.B : e.A; if (!seen.has(m)) { seen.set(m, seen.get(q[i]) + 1); q.push(m); } }
  return seen;
}
let tSel = null, tHover = null, tDown = null, tUp = null, tPop = null, _tPopMount = null;
const tpulses = [];
function pickTrace(px, py) {
  let best = null, bd = 12 * 12;
  for (const n of tn) { const dx = sx(n.x) - px, dy = sy(n.y) - py; const d = dx * dx + dy * dy; if (d < bd) { bd = d; best = n; } }
  if (!best) { // labels are targets too
    for (const n of tn) { const y = sy(n.y), x = sx(n.x); if (Math.abs(py - y) < ROWH * cam.k / 2 && (n.col === 0 ? px < x && px > x - 170 : px > x && px < x + 170)) return n; }
  }
  return best;
}
function tCurve(e) {
  const a = e.A, b = e.B, back = b.x < a.x;
  const P0 = { x: sx(a.x), y: sy(a.y) }, P3 = { x: sx(b.x), y: sy(b.y) }, dx = (P3.x - P0.x) * 0.5;
  return [P0, { x: P0.x + dx, y: P0.y }, { x: P3.x - dx, y: P3.y }, P3, back];
}
const bez = (c, u) => { const v = 1 - u; return { x: v * v * v * c[0].x + 3 * v * v * u * c[1].x + 3 * v * u * u * c[2].x + u * u * u * c[3].x, y: v * v * v * c[0].y + 3 * v * v * u * c[1].y + 3 * v * u * u * c[2].y + u * u * u * c[3].y }; };
function fireTrace(n) {
  const down = flow(n, 1), now = performance.now(), H0 = Math.max(240, 420 / Math.sqrt(speed));
  n.en = 1;
  for (const e of te) { const da = down.get(e.A), db = down.get(e.B); if (da !== undefined && db === da + 1) tpulses.push({ e, t0: now + da * H0, dur: H0 * 0.95 }); }
}
function tGlyph(n, x, y, hot) {
  const g = ctx, lum = { view: '#fafafa', widget: '#cfcfcf', feature: '#a3a3a3', entity: '#737373' }[n.kind];
  g.lineWidth = 1.2;
  if (n.kind === 'route') { g.strokeStyle = COL.t1; if (n.redirect) g.setLineDash([2, 2]); g.fillStyle = '#0c0c0c'; g.beginPath(); g.arc(x, y, 4.5, 0, Math.PI * 2); g.fill(); g.stroke(); g.setLineDash([]); }
  else if (lum) { g.fillStyle = hot ? '#ffffff' : lum; g.fillRect(x - 3.5, y - 3.5, 7, 7); }
  else if (n.kind === 'intent' || n.kind === 'prompt') { g.beginPath(); g.moveTo(x, y - 4.5); g.lineTo(x + 4.5, y); g.lineTo(x, y + 4.5); g.lineTo(x - 4.5, y); g.closePath(); if (n.kind === 'intent') { g.fillStyle = COL.t2; g.fill(); } else { g.strokeStyle = COL.t2; g.stroke(); } }
  else if (n.kind === 'mcp' || n.kind === 'desktop') { g.strokeStyle = COL.t2; g.strokeRect(x - 3.5, y - 3.5, 7, 7); if (n.kind === 'desktop') { g.fillStyle = COL.t2; g.fillRect(x - 1, y - 1, 2, 2); } }
  else if (n.kind === 'jsonl') { g.strokeStyle = COL.t2; g.beginPath(); g.arc(x, y, 3.8, 0, Math.PI * 2); g.stroke(); }
  else if (n.kind === 'meaning') { g.fillStyle = COL.t2; g.beginPath(); g.arc(x, y, 3.8, 0, Math.PI * 2); g.fill(); }
  else if (n.kind === 'decision') { g.strokeStyle = COL.t1; g.strokeRect(x - 3, y - 4.5, 6, 9); g.beginPath(); g.moveTo(x - 1.5, y - 1.5); g.lineTo(x + 1.5, y - 1.5); g.moveTo(x - 1.5, y + 1); g.lineTo(x + 1.5, y + 1); g.stroke(); }
}
function drawTrace(t, dt) {
  const focus = tSel || tHover;
  const down = focus ? (focus === tSel && tDown ? tDown : flow(focus, 1)) : null, up = focus ? (focus === tSel && tUp ? tUp : flow(focus, -1)) : null;
  const inChain = n => !focus || down.has(n) || up.has(n);
  const edgeOn = e => focus && ((down.has(e.A) && down.get(e.B) === down.get(e.A) + 1) || (up.has(e.B) && up.get(e.A) === up.get(e.B) + 1));
  const fade = Math.exp(-dt / 900);
  for (const n of tn) n.en *= fade;
  for (const e of te) e.en *= fade;
  // column headers
  ctx.textAlign = 'left'; ctx.font = '500 10px "Geist Mono", ui-monospace, monospace'; ctx.letterSpacing = '0.8px';
  const top = sy(-(tallest * ROWH) / 2 - 30);
  COLS.forEach((c, i) => {
    const x = sx(i * COLW);
    ctx.fillStyle = COL.t2; ctx.textAlign = i === 0 ? 'right' : 'left';
    ctx.fillText(c.title.toUpperCase(), x + (i === 0 ? 6 : -6), top);
    ctx.fillStyle = COL.t4; ctx.fillText(String(byCol[i].length), x + (i === 0 ? 6 : -6), top + 14);
  });
  ctx.letterSpacing = '0px';
  // edges
  for (const e of te) {
    const on = edgeOn(e);
    ctx.strokeStyle = on ? 'rgba(255,255,255,0.55)' : focus ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.07)';
    ctx.lineWidth = on ? 1.3 : 1;
    const c = tCurve(e);
    ctx.beginPath(); ctx.moveTo(c[0].x, c[0].y); ctx.bezierCurveTo(c[1].x, c[1].y, c[2].x, c[2].y, c[3].x, c[3].y); ctx.stroke();
    if (e.en > 0.03) { ctx.strokeStyle = `rgba(255,255,255,${0.5 * e.en})`; ctx.lineWidth = 1.6; ctx.stroke(); }
  }
  // pulses along the chain
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = tpulses.length - 1; i >= 0; i--) {
    const p = tpulses[i], u = (t - p.t0) / p.dur;
    if (u < 0) continue;
    if (u >= 1) { p.e.B.en = 1; p.e.en = 1; tpulses.splice(i, 1); continue; }
    const c = tCurve(p.e), s = ease(u);
    for (let j = 0; j < 10; j++) {
      const q = bez(c, Math.max(0, s - j * 0.025)), a = (1 - j / 10);
      ctx.fillStyle = `rgba(255,255,255,${0.8 * a * a})`; ctx.beginPath(); ctx.arc(q.x, q.y, 2.2 * a + 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
  // nodes and labels
  const showAll = cam.k * ROWH >= 12.5;
  for (const n of tn) {
    const x = sx(n.x), y = sy(n.y), on = inChain(n);
    ctx.globalAlpha = on ? 1 : 0.16;
    if (n.en > 0.05) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; const g = ctx.createRadialGradient(x, y, 1, x, y, 14 * n.en + 4); g.addColorStop(0, `rgba(255,255,255,${0.45 * n.en})`); g.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 14 * n.en + 4, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
    tGlyph(n, x, y, n === tSel);
    if (n === tSel) { ctx.strokeStyle = COL.t1; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 8 + (REDUCED ? 0 : Math.sin(t / 520)), 0, Math.PI * 2); ctx.stroke(); }
    if (showAll || n === focus || (focus && on) || n.kind === 'route') {
      const left = n.col === 0;
      let text = n.label;
      if (n.kind === 'decision') text = `${n.date} · ${n.label}`.slice(0, 44) + (n.label.length > 32 ? '…' : '');
      ctx.font = `${n === focus ? 600 : 500} 11.5px Geist, ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = left ? 'right' : 'left';
      const tx = x + (left ? -10 : 10);
      ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(10,10,10,0.95)'; ctx.lineJoin = 'round'; ctx.strokeText(text, tx, y + 4);
      ctx.fillStyle = focus && on ? COL.t1 : n.kind === 'route' ? COL.t1 : COL.t3; ctx.fillText(text, tx, y + 4);
      const extra = n.redirect ? `→ ${n.redirect}` : n.controlCount ? `${n.controlCount}` : '';
      if (extra && !left) { const w = ctx.measureText(text).width; ctx.font = '10px "Geist Mono", ui-monospace, monospace'; ctx.fillStyle = COL.t4; ctx.fillText(extra, tx + w + 7, y + 4); }
    }
  }
  ctx.globalAlpha = 1;
  placeTracePop();
}

// json-render style: the route as a flat element map, then rendered through a component catalogue
function specFor(route) {
  const elements = {};
  const put = (key, type, props, children = []) => { elements[key] = { key, type, props, children }; return key; };
  const build = (n, depth, seen) => {
    const key = n.id.replace(/^slice:/, '');
    if (elements[key] || seen.has(n)) return key;
    seen.add(n);
    const children = [];
    n.controls.slice(0, 6).forEach((c, i) => children.push(put(`${key}#${i + 1}`, 'Button', { label: c.label, onClick: c.handler, source: `${c.file}:${c.line}` })));
    for (const e of tOut.get(n)) {
      const m = e.B;
      if (/^slice:/.test(m.id) && m.kind !== 'entity' && depth < 3) children.push(build(m, depth + 1, seen));
      else if (['intent', 'prompt', 'mcp', 'desktop', 'jsonl'].includes(m.kind)) { const k = `${m.kind}:${m.label}`; elements[k] ??= { key: k, type: { intent: 'Intent', prompt: 'Prompt', mcp: 'Tool', desktop: 'Command', jsonl: 'Log' }[m.kind], props: { name: m.label }, children: [] }; children.push(k); }
    }
    put(key, { view: 'View', widget: 'Widget', feature: 'Feature', entity: 'Entity' }[n.kind], { name: n.label, files: n.files.length, controls: n.controlCount }, children.slice(0, 14));
    return key;
  };
  const seen = new Set();
  const kids = tOut.get(route).map(e => e.B).filter(m => /^slice:/.test(m.id)).map(m => build(m, 1, seen));
  const root = { key: 'route', type: 'Route', props: { path: route.label, file: route.files[0], ...(route.redirect ? { redirectsTo: route.redirect } : {}) }, children: kids };
  return { root: 'route', elements: { route: root, ...elements } };
}
function specHtml(spec) {
  const json = JSON.stringify(spec, null, 2);
  return esc(json).replace(/(&quot;[^&]*?&quot;)(\s*:)/g, '<span class="k">$1</span>$2').replace(/:\s(&quot;.*?&quot;)/g, ': <span class="s">$1</span>').replace(/:\s(-?\d+)/g, ': <span class="n">$1</span>');
}
const CATALOG = {
  Route: (el, r) => `<div class="jr-route"><div class="bar"><i></i><i></i><i></i><span>${esc(el.props.path)}</span>${el.props.redirectsTo ? `<span>→ ${esc(el.props.redirectsTo)}</span>` : ''}</div><div class="jr-body">${r(el.children) || '<span class="m" style="color:var(--t4)">Renders no view of its own.</span>'}</div></div>`,
  Slice: (el, r) => `<div class="${el.type === 'View' ? 'jr-view' : 'jr-slice'}"><div class="h"><span>${el.type} · ${esc(el.props.name)}</span><span>${el.props.controls} controls · ${el.props.files} files</span></div>${r(el.children)}</div>`,
  Button: el => `<button class="jr-btn ${!el.props.label || el.props.label.startsWith('key:') ? 'key' : ''}" tabindex="-1" title="${esc(el.props.source)}${el.props.onClick ? ' · onClick ' + esc(el.props.onClick) : ''}">${esc(el.props.label && !el.props.label.startsWith('key:') ? el.props.label : el.props.label ? el.props.label.slice(4) : (el.props.onClick || 'button') + '()')}</button>`,
  Chip: el => `<span class="jr-chip">${el.type.toLowerCase()} · ${esc(el.props.name)}</span>`,
};
function renderSpec(spec) {
  const r = keys => {
    const els = keys.map(k => spec.elements[k]).filter(Boolean);
    const buttons = els.filter(e => e.type === 'Button'), chips = els.filter(e => ['Intent', 'Prompt', 'Tool', 'Command', 'Log'].includes(e.type)), rest = els.filter(e => !buttons.includes(e) && !chips.includes(e));
    return (buttons.length ? `<div class="jr-row">${buttons.map(b => CATALOG.Button(b)).join('')}</div>` : '') + (chips.length ? `<div class="jr-row">${chips.map(c => CATALOG.Chip(c)).join('')}</div>` : '') + rest.map(e => CATALOG.Slice(e, r)).join('');
  };
  return CATALOG.Route(spec.elements[spec.root], r);
}

function chainHtml(n) {
  const down = flow(n, 1), up = flow(n, -1), groups = new Map();
  for (const m of new Set([...down.keys(), ...up.keys()])) { if (m === n) continue; const c = COLS[m.col].title; if (!groups.has(c)) groups.set(c, []); groups.get(c).push(m); }
  return `<div class="chain">${COLS.filter(c => groups.has(c.title)).map(c => `<div><h4>${esc(c.title)} · ${groups.get(c.title).length}</h4><div class="items">${groups.get(c.title).sort((a, b) => a.label.localeCompare(b.label)).slice(0, 40).map(m => `<button data-tgo="${esc(m.id)}">${esc(m.label)}</button>`).join('')}</div></div>`).join('') || '<p class="m" style="color:var(--t4);font-size:12px">Nothing connects here.</p>'}</div>`;
}
const controlsHtml = n => n.controls.length ? `<div class="ctrls">${n.controls.map(c => `<div><span>${esc(c.label && !c.label.startsWith('key:') ? c.label : (c.label ? c.label.slice(4) : (c.handler || 'button') + '()'))}</span><span class="mono">${esc(c.file.split('/').pop())}:${c.line}</span></div>`).join('')}${n.controlCount > n.controls.length ? `<div><span class="mono">+${n.controlCount - n.controls.length} more</span></div>` : ''}</div>` : '<p style="color:var(--t4);font-size:12px">No buttons in this slice\'s own files.</p>';
const filesHtml = n => `<div class="flist">${n.files.slice(0, 30).map(f => `<span>${esc(f)}</span>`).join('')}${n.files.length > 30 ? `<span>+${n.files.length - 30} more</span>` : ''}</div>`;
function traceTabs(n) {
  if (n.kind === 'route') return [{ id: 'chain', label: 'Chain' }, { id: 'spec', label: 'Spec' }, { id: 'rendered', label: 'Rendered' }];
  if (/^slice:/.test(n.id)) return [{ id: 'controls', label: 'Controls', n: n.controlCount }, { id: 'chain', label: 'Chain' }, { id: 'files', label: 'Files', n: n.files.length }];
  return [{ id: 'chain', label: 'Chain' }, ...(n.files.length ? [{ id: 'files', label: 'Files', n: n.files.length }] : [])];
}
function mountTrace(host, n, tab) {
  if (tab === 'spec') host.innerHTML = `<pre class="spec">${specHtml(specFor(n))}</pre>`;
  else if (tab === 'rendered') host.innerHTML = `<div class="jr">${renderSpec(specFor(n))}</div>`;
  else if (tab === 'controls') host.innerHTML = controlsHtml(n);
  else if (tab === 'files') host.innerHTML = filesHtml(n);
  else host.innerHTML = chainHtml(n);
  host.querySelectorAll('[data-tgo]').forEach(b => b.onclick = () => selectTrace(tById.get(b.dataset.tgo)));
}
function selectTrace(n, tab) {
  closeTrace(true);
  tSel = n; tDown = flow(n, 1); tUp = flow(n, -1);
  const tabs = traceTabs(n), cur0 = tab && tabs.some(x => x.id === tab) ? tab : tabs[0].id;
  tPop = document.createElement('div');
  tPop.className = 'pop'; tPop.setAttribute('role', 'dialog'); tPop.setAttribute('aria-label', n.label);
  const vault = n.kind === 'meaning' ? byId.get(n.slug) : null;
  tPop.innerHTML = `<button class="close" aria-label="Close">${ICON.x}</button>
    <header><div class="kind">${TKIND[n.kind]}</div><h2>${esc(n.kind === 'decision' ? n.label : n.label)}</h2>${n.files[0] ? `<div class="path">${esc(n.files[0])}</div>` : ''}
    <div class="rev">${n.redirect ? `Redirects to ${esc(n.redirect)} · ` : ''}${tDown.size - 1} downstream · ${tUp.size - 1} upstream${n.controlCount ? ` · ${n.controlCount} controls` : ''}${n.date ? ` · ${esc(n.date)}` : ''}</div></header>
    <div class="tabs" role="tablist">${tabBar(tabs, cur0)}</div><div class="tabbody" role="tabpanel"></div>
    <footer><button class="btn primary" data-act="flow">${ICON.pulse}Trace the flow</button>${vault ? '<button class="btn" data-act="map">Open in map</button>' : ''}<span class="grow"></span></footer>`;
  stage.appendChild(tPop);
  const body = tPop.querySelector('.tabbody');
  mountTrace(body, n, cur0);
  tPop.querySelector('.close').onclick = () => closeTrace();
  tPop.querySelector('.tabs').onclick = ev => { const b = ev.target.closest('[data-tab]'); if (!b) return; tPop.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b)); mountTrace(body, n, b.dataset.tab); };
  tPop.querySelector('[data-act=flow]').onclick = () => fireTrace(n);
  if (vault) tPop.querySelector('[data-act=map]').onclick = () => { setView('map'); goTo(vault); };
  placeTracePop(true);
  fireTrace(n);
}
function closeTrace(keep) { tPop?.remove(); tPop = null; if (!keep) { tSel = null; tDown = tUp = null; } }
function placeTracePop(first) {
  if (!tPop || !tSel || innerWidth <= 640) return;
  const x = sx(tSel.x), y = sy(tSel.y), pw = tPop.offsetWidth, ph = tPop.offsetHeight;
  const right = x + 190 + pw <= W - 12 && tSel.col < COLS.length - 2;
  const minLeft = drawer && W > 900 ? (drawerEl?.offsetWidth || 344) + 12 : 12;
  const left = Math.max(minLeft, Math.min(W - pw - 12, right ? x + 190 : x - 24 - pw));
  const top = Math.max(12, Math.min(H - ph - 12, y - 64));
  tPop.style.left = `${left}px`; tPop.style.top = `${top}px`;
  if (first) { tPop.style.setProperty('--ox', `${right ? 0 : pw}px`); tPop.style.setProperty('--oy', `${y - top}px`); }
}

// ---------------------------------------------------------------- decide: the product-review matrix, computed by the repo's router
let mxEvidence = 'observed';
function renderDecide() {
  const M = T.matrix, cells = M.cells[mxEvidence];
  const routeDecisions = tn.filter(n => n.kind === 'route').map(r => ({ r, ds: tOut.get(r).map(e => e.B).filter(m => m.kind === 'decision') })).filter(x => x.ds.length);
  drawerEl.innerHTML = `<header><div class="kind">Decide</div><h2>Which door, which risk, which reviewers</h2><p>Every cell is the output of <span class="mono" style="font-size:11px">scripts/lib/po-risk-router.mjs</span> run on that combination, outcome <span class="mono" style="font-size:11px">judge</span>, at ${esc(T.head)}.</p><button class="close" aria-label="Close decide">${ICON_CLOSE}</button></header>
  <div class="dbody">
    <div class="field"><span>Evidence for the change</span><div class="seg" role="group" aria-label="Evidence" id="mx-ev">${M.evidence.map(e => `<button aria-pressed="${e === mxEvidence}" data-ev="${e}">${e}</button>`).join('')}</div></div>
    <div class="mxwrap"><table class="mx"><thead><tr><th>Change</th>${M.conditions.map(c => `<th title="${esc(c.desc || '')}">${esc(c.id === 'none' ? 'No boundary' : c.id)}</th>`).join('')}</tr></thead>
    <tbody>${Object.keys(M.changes).map(ch => `<tr><td class="rh" title="${esc(M.changes[ch].reason)}">${esc(ch)}</td>${M.conditions.map(c => { const v = cells[ch][c.id]; return `<td title="${esc((v.reasons || []).join(' · '))}"><div class="cell"><span class="door ${v.door === 'one-way' ? 'one' : 'two'}">${esc(v.door.toUpperCase())}</span><span>${esc(v.risk)}</span><span class="rv">${esc((v.reviewers || []).join(' + ') || 'solo pass')}</span></div></td>`; }).join('')}</tr>`).join('')}</tbody></table></div>
    <div class="dsec"><h3>Boundaries</h3>${M.conditions.filter(c => c.desc).map(c => `<p class="m"><span class="mono" style="color:var(--t2)">${esc(c.id)}</span> — ${esc(c.desc)}</p>`).join('')}</div>
    <div class="dsec"><h3>Routes with a recorded decision</h3><div class="rows">${routeDecisions.map(({ r, ds }) => `<button class="row" data-troute="${esc(r.id)}"><b>${esc(r.label)}</b><span class="v">${ds.length}</span>${ds.map(d => `<span class="sub">${esc(d.date)} · ${esc(d.label)}</span>`).join('')}</button>`).join('')}</div></div>
  </div>`;
  drawerEl.querySelector('.close').onclick = () => openDrawer(null);
  drawerEl.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => { mxEvidence = b.dataset.ev; renderDecide(); });
  drawerEl.querySelectorAll('[data-troute]').forEach(b => b.onclick = () => { setView('trace'); selectTrace(tById.get(b.dataset.troute)); });
}


// ---------------------------------------------------------------- sources: every dataset, parsed and tested by one implementation
const SRC = JSON.parse(document.getElementById('sources-data').textContent);
const sources = new Map();
for (const [k, v] of Object.entries(SRC)) {
  const graph = AtlasSources.parseVault(v.files, v.label);
  sources.set(k, { key: k, label: v.label, note: v.note, kind: 'vault', graph, checks: AtlasSources.testVault(graph) });
}
function testTrace() {
  const routes = tn.filter(n => n.kind === 'route'), c = [];
  const add = (id, label, status, value, detail, examples = []) => c.push({ id, label, status, value, detail, examples: examples.slice(0, 5) });
  const noView = routes.filter(r => !tOut.get(r).some(e => /^slice:/.test(e.B.id)));
  add('routes', 'Every route renders a view', noView.length ? 'fail' : 'pass', `${routes.length - noView.length}/${routes.length}`, `${routes.filter(r => r.redirect).length} of them redirect`, noView.map(r => r.label));
  const all = tn.flatMap(n => n.controls || []), named = all.filter(x => x.label && !x.label.startsWith('key:'));
  add('labels', 'Buttons carry a readable label', named.length / Math.max(1, all.length) >= 0.6 ? 'pass' : 'warn', `${named.length}/${all.length}`, `${all.filter(x => x.label?.startsWith('key:')).length} show a raw message key, ${all.filter(x => !x.label).length} only a handler name`, all.filter(x => x.label?.startsWith('key:')).map(x => `${x.label.slice(4)} · ${x.file.split('/').pop()}:${x.line}`));
  const reachContract = routes.filter(r => [...flow(r, 1).keys()].some(m => m.kind === 'mcp' || m.kind === 'desktop'));
  add('contracts', 'Routes reach an MCP tool or desktop command', 'info', `${reachContract.length}/${routes.length}`, 'through their imports, not by URL');
  const slices = tn.filter(n => /^slice:/.test(n.id)), meant = slices.filter(n => tOut.get(n).some(e => e.B.kind === 'meaning'));
  add('meaning', 'Code modules named by a vault capability', meant.length / slices.length >= 0.25 ? 'pass' : 'warn', `${meant.length}/${slices.length}`, 'a capability whose path lives in the module');
  const orphan = slices.filter(n => !tIn.get(n).length);
  add('reached', 'Every module is reached from a route', orphan.length ? 'warn' : 'pass', `${slices.length - orphan.length}/${slices.length}`, orphan.length ? `${orphan.length} imported by nothing a route loads` : 'all reached', orphan.map(n => n.id.slice(6)));
  return c;
}
function testHistory() {
  const lost = commits.filter(c => c.nodes.length < c.n.length);
  const c = [{ id: 'resolve', label: 'Every commit names pages that still exist', status: lost.length ? 'warn' : 'pass', value: `${commits.length - lost.length}/${commits.length}`, detail: lost.length ? `${lost.length} commits touched pages since renamed or removed` : 'all resolve', examples: lost.slice(0, 5).map(x => `${x.h.slice(0, 7)} · ${x.n.filter(s => !byId.has(s)).slice(0, 2).join(', ')}`) }];
  const gaps = commits.slice(1).map((x, i) => (x.t - commits[i].t) / 36e5);
  c.push({ id: 'cadence', label: 'Change cadence', status: 'info', value: `${commits.length} commits`, detail: `median gap ${gaps.sort((a, b) => a - b)[gaps.length >> 1].toFixed(1)} h, longest ${(Math.max(...gaps) / 24).toFixed(1)} days`, examples: [] });
  return c;
}
sources.set('trace', { key: 'trace', label: 'Code trace', note: 'routes → views → buttons → contracts → meaning, this repository', kind: 'trace', checks: testTrace() });
sources.set('spacetime', { key: 'spacetime', label: 'Spacetime', note: `every concept as a worldline through ${TL ? TL.commits.length : commits.length} real commits`, kind: 'spacetime', checks: [{ id: 'lanes', label: 'Both lanes of history', status: 'info', value: `${TL ? TL.commits.length : commits.length} commits`, detail: TL ? `${TL.commits.filter(c => c.n.length).length} changed pages, ${TL.commits.filter(c => c.code.length).length} changed code` : 'pages only' }] });
sources.set('history', { key: 'history', label: 'Commit history', note: `${commits.length} commits that changed the vault`, kind: 'history', checks: testHistory() });
let srcKey = 'atlas';
const studioSrc = new Map();
function studioSource(key) {
  if (studioSrc.has(key)) return studioSrc.get(key);
  const s = sources.get(key); let out;
  if (s.kind === 'vault') out = { kind: 'vault', graph: s.graph };
  else if (s.kind === 'trace') out = { kind: 'trace', T, spec: raw => {
    const r = tById.get(raw.id), sections = [];
    const walk = (n, depth) => { for (const e of tOut.get(n)) { const m = e.B; if (!/^slice:/.test(m.id) || m.kind === 'entity' || sections.some(x => x.name === m.label)) continue; sections.push({ kind: m.kind, name: m.label, buttons: (m.controls || []).filter(c => c.label && !c.label.startsWith('key:')).slice(0, 5).map(c => c.label) }); if (depth < 2) walk(m, depth + 1); } };
    walk(r, 1);
    return { label: r.label, redirect: r.redirect, sections: sections.slice(0, 8) };
  } };
  else if (s.kind === 'spacetime') {
    const evs = (TL?.commits || commits.map(c => ({ h: c.h, d: c.d, s: c.s, n: c.n, code: [], reach: [], add: 0, del: 0 }))).map(c => ({ ...c, t: +new Date(c.d) }));
    const count = new Map(nodes.map(n => [n.s, { e: 0, p: 0, c: 0 }]));
    for (const e of evs) { for (const x of e.n) if (count.has(x)) { count.get(x).e++; count.get(x).p++; } for (const x of e.code) if (count.has(x) && !e.n.includes(x)) { count.get(x).e++; count.get(x).c++; } }
    out = { kind: 'spacetime', t0: Math.min(...evs.map(e => e.t)), t1: Math.max(...evs.map(e => e.t)), events: evs,
      nodes: nodes.map(n => ({ s: n.s, t: n.t, k: n.k, x: n.mx, z: n.my, events: count.get(n.s).e, pageEvents: count.get(n.s).p, codeEvents: count.get(n.s).c })) };
  }
  else out = { kind: 'history', commits: commits.map(c => ({ h: c.h, d: c.d, s: c.s, work: c.w, n: c.n.length })) };
  studioSrc.set(key, out); return out;
}
function fillPicker() {
  $('#srcpick').innerHTML = [...sources.values()].map(s => `<option value="${esc(s.key)}" ${s.key === srcKey ? 'selected' : ''}>${esc(s.label)}${s.kind === 'vault' ? ` · ${s.graph.nodes.length}` : ''}</option>`).join('');
}
fillPicker();
$('#srcpick').addEventListener('change', ev => { srcKey = ev.target.value; openStudio(srcKey); });
let studio = null, studioWaiting = null;
function openStudio(key) {
  srcKey = key; fillPicker();
  const go = async () => {
    await document.fonts.ready; // print pages with the real faces
    studio ??= window.createAtlasStudio($('#studio'), {
      canOpen: it => srcKey === 'atlas' && byId.has(it.key),
      openInMap: it => { setView('map'); goTo(byId.get(it.key)); },
    });
    $('#studio-loading').hidden = true;
    window.__atlasStudio = studio; // lets a test harness drive the stage
    if (view === 'studio') studio.show(studioSource(key));
  };
  if (window.createAtlasStudio) go();
  else if (!studioWaiting) { studioWaiting = true; addEventListener('atlas-studio-ready', go, { once: true }); }
}
// a folder the viewer picks: read in this browser, parsed and tested by the same code
$('#folderpick').addEventListener('change', async ev => {
  const list = [...ev.target.files].filter(f => /\.md$/i.test(f.name) && f.size < 400_000).slice(0, 3000);
  if (!list.length) { flash('That folder has no Markdown pages.'); return; }
  const files = await Promise.all(list.map(async f => ({ path: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, text: await f.text() })));
  const name = (list[0].webkitRelativePath || 'Your folder').split('/')[0];
  const graph = AtlasSources.parseVault(files, name), key = `folder:${name}:${Date.now()}`;
  sources.set(key, { key, label: `${name} (your folder)`, note: `${files.length} Markdown files, read in this browser only`, kind: 'vault', graph, checks: AtlasSources.testVault(graph) });
  ev.target.value = '';
  fillPicker(); if (drawer === 'sources') renderSources();
  if (graph.nodes.length) { srcKey = key; setView('studio'); openStudio(key); }
  else flash(`No concept pages found in ${name}: pages need a slug and kind in their frontmatter.`);
});
const MARK = { pass: '✓', warn: '!', fail: '✕', info: 'i' };
function renderSources() {
  drawerEl.innerHTML = `<header><div class="kind">Sources</div><h2>Every dataset, tested the same way</h2><p>One parser and one set of connection checks run on each source. Your own folder is read in this browser and never uploaded.</p><button class="close" aria-label="Close sources">${ICON_CLOSE}</button></header>
  <div class="dbody">
    <div class="actions"><button class="btn primary" id="loadfolder">Load a vault folder…</button></div>
    ${[...sources.values()].map(s => { const sm = AtlasSources.summary(s.checks); return `<div class="src"><div class="top"><b>${esc(s.label)}</b><div class="badges"><span>${sm.pass} pass</span>${sm.warn ? `<span>${sm.warn} warn</span>` : ''}${sm.fail ? `<span class="fail">${sm.fail} fail</span>` : ''}</div></div>
      <div class="note">${esc(s.note)}${s.kind === 'vault' ? ` · ${s.graph.nodes.length} concepts · ${s.graph.edges.length} relations` : ''}</div>
      <div class="checks2">${s.checks.map(c => `<div class="ck ${c.status}"><i>${MARK[c.status]}</i><span>${esc(c.label)}</span><span class="v">${esc(c.value)}</span>${c.detail ? `<span class="d">${esc(c.detail)}</span>` : ''}${c.examples?.length && c.status !== 'pass' && c.status !== 'info' ? `<span class="ex">${c.examples.map(esc).join('<br>')}</span>` : ''}</div>`).join('')}</div>
      <div class="actions"><button class="btn" data-studio="${esc(s.key)}">Open in Studio</button></div></div>`; }).join('')}
  </div>`;
  drawerEl.querySelector('.close').onclick = () => openDrawer(null);
  drawerEl.querySelector('#loadfolder').onclick = () => $('#folderpick').click();
  drawerEl.querySelectorAll('[data-studio]').forEach(b => b.onclick = () => { srcKey = b.dataset.studio; openDrawer(null); setView('studio'); openStudio(srcKey); });
}

// ---------------------------------------------------------------- boot
$('#stats').textContent = `${nodes.length} concepts · ${edges.length} relations · ${commits.length} changes`;
resize();
Object.assign(cam, fitFor('map'));
new ResizeObserver(() => { resize(); }).observe(stage);
requestAnimationFrame(t => { last = t; frame(t); });
showCommit(commits.length - 1, { wave: false });
timeDepth = cur;
renderNav();
$('#hint').textContent = 'Drag to pan · scroll to zoom · ' + KEYS;
const deep = (location.hash || '').slice(1);
setTimeout(() => {
  if (['tiers', 'time', 'trace', 'studio'].includes(deep)) setView(deep);
  showCommit(commits.length - 1);
  // #capabilities/<slug> (any concept id) opens that concept; otherwise the map only leans toward the most
  // revised capability, and no card covers the stage until the reader asks for one
  if (byId.has(deep)) goTo(byId.get(deep));
  else if (innerWidth > 640 && !['time', 'trace', 'studio'].includes(deep)) {
    const start = nodes.filter(n => n.k === 'capability' && reach(n).order.length > 4).sort((a, b) => b.revs - a.revs)[0];
    if (start) focusNode(start);
  }
}, REDUCED ? 0 : 500);
})();
