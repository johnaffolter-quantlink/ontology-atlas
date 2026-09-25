/**
 * Live layer: the people looking at this graph right now, channels that persist per concept,
 * agents that plan, critique and reflect using the graph as their only tools, and an optional
 * read-only bridge to a Slack channel. Every part lights up only when the viewer's platform
 * grants it; without any of them the page is the same single-viewer atlas.
 */
(() => {
'use strict';
const A = window.__atlas;
if (!A) return;
const { nodes, byId, esc } = A;

// ---------------------------------------------------------------- capabilities (each may be null)
const cap = { room: null, db: null, user: null, sample: null, mcp: null };
const use = name => (window.claude?.use ? window.claude.use(name).catch(() => null) : Promise.resolve(null));
let me = { id: null, color: '#d4d4d4', name: '' };
let canSendClaude = 'off';

// ---------------------------------------------------------------- state
const AGENTS = {
  planner: { name: 'Planner', role: 'turns a goal into steps grounded in what each change reaches' },
  reviewer: { name: 'Reviewer', role: 'checks a plan against dependents, cycles and what people are working on now' },
  cartographer: { name: 'Cartographer', role: 'answers questions about the graph: what contains, depends on or reaches what' },
};
let peers = [];                  // room peers
const names = new Map();         // user id -> display name, as this viewer sees them
let channel = 'general', followSel = true;
let msgs = [], unsubMsgs = null, index = {}, agentState = {}, bridge = null, slack = { items: [], state: 'off', err: '' };
let unsubSlack = null, slackFor = null;
const pings = [];                // {s, t0, col}
let tier = 'quick', busy = null, notice = '';
let drawerEl = null, _closeDrawer = null;

const keyOf = slug => slug ? 'c.' + slug.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 180) : 'general';
const slugOfKey = k => k === 'general' ? null : nodes.find(n => keyOf(n.s) === k)?.s ?? null;
const titleOfKey = k => k === 'general' ? 'general' : (byId.get(slugOfKey(k))?.t ?? k.slice(2));
const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)} min` : s < 86400 ? `${Math.floor(s / 3600)} h` : `${Math.floor(s / 86400)} d`; };
const uid = () => (crypto.randomUUID?.() || String(Math.random()).slice(2)).replace(/-/g, '').slice(0, 20);

// ---------------------------------------------------------------- serialized writes (one at a time per document)
const chains = new Map();
function write(path, fn) {
  const prev = chains.get(path) || Promise.resolve();
  const next = prev.then(fn).catch(e => { if (e?.code === 'quota_exceeded') setNotice('This board is full. Older messages need clearing before new ones fit.'); else if (e?.code === 'invalid_argument') setNotice('You can read this board but not write to it.'); });
  chains.set(path, next); return next;
}
async function merge(path, body) {
  const ref = cap.db.doc(path);
  try { await ref.update(body); } catch (e) { if (e?.code === 'invalid_argument') await ref.set(body); else throw e; }
}
function setNotice(t) { notice = t; render(); }

// ---------------------------------------------------------------- boot
(async () => {
  const [room, db, user, sample, mcp] = await Promise.all(['room', 'db', 'user', 'sample', 'mcp'].map(use));
  Object.assign(cap, { room, db, user, sample, mcp });
  if (user) { me = await user.me(); if (me.id) names.set(me.id, me.name || 'You'); }
  if (room) {
    room.onPeers(ch => { peers = ch.peers.filter(p => p.kind === 'viewer'); resolveNames(peers.map(p => p.by || p.presence?.id).filter(Boolean)); badge(); render(); });
    room.on('ping', m => { const n = byId.get(String(m.data?.s || '')); if (!n) return; pings.push({ s: n.s, t0: performance.now(), col: String(m.data?.col || '#fafafa').slice(0, 20) }); A.fire(n, { strength: 1, cap: 60 }); if (!m.sameTab) A.flash(`${nameOf(m.by || m.data?.id) || 'Someone'} pointed at ${n.t}`); });
    sendPresence(A.selected);
    try { canSendClaude = await room.canSendToClaudeSession(); } catch { canSendClaude = 'off'; }
  }
  if (db) {
    db.doc('boards/index').onSnapshot(s => { index = s.data()?.ch || {}; render(); }, () => {});
    db.doc('agents/status').onSnapshot(s => { agentState = s.data() || {}; render(); }, () => {});
    openChannel(channel);
  }
  render();
})();

function badge() {
  const el = document.querySelector('#livebtn .livecount'); if (!el) return;
  el.hidden = peers.length < 2; el.textContent = String(peers.length);
}
async function resolveNames(ids) {
  if (!cap.user || !ids.length) return;
  const ps = await cap.user.profiles([...new Set(ids)]);
  for (const [id, p] of Object.entries(ps)) names.set(id, p.isMe ? (p.name || 'You') : (p.name || 'Someone'));
  render();
}
const nameOf = id => id ? names.get(id) || '' : '';

// ---------------------------------------------------------------- presence follows the selection
function sendPresence(n) { cap.room?.presence({ at: n ? n.s : null, view: A.view, col: me.color, id: me.id }).catch(() => {}); }
A.hooks.select.push(n => {
  sendPresence(n);
  if (followSel && A.drawer === 'live') { channel = keyOf(n.s); openChannel(channel); }
});

// ---------------------------------------------------------------- channels
function openChannel(k) {
  unsubMsgs?.(); msgs = []; unsubMsgs = null;
  if (!cap.db) { render(); return; }
  let first = true;
  unsubMsgs = cap.db.collection(`boards/${k}/msgs`).orderBy('at', 'desc').limit(120).onSnapshot(snap => {
    msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })).reverse();
    resolveNames(msgs.map(m => m.by).filter(Boolean));
    if (!first) for (const ch of snap.docChanges()) if (ch.type === 'added') { const m = ch.doc.data(); const n = byId.get((m.refs || [])[0]) || byId.get(slugOfKey(k)); if (n) A.fire(n, { strength: 0.8, cap: 50, work: m.agent ? 'plan' : 'build' }); }
    first = false; render(true);
  }, () => { msgs = []; render(); });
  watchBridge(k);
}
const refsIn = text => [...new Set([...String(text).matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].trim()).filter(s => byId.has(s)))];
function post(k, body) {
  if (!cap.db) return Promise.resolve();
  const at = Date.now(), text = String(body.text || '').slice(0, 4000);
  const doc = { at, text, refs: body.refs || refsIn(text), kind: body.kind || 'msg', ...(body.agent ? { agent: body.agent } : { by: me.id }), ...(body.steps ? { steps: body.steps.slice(0, 8) } : {}) };
  const id = uid();
  return write(`boards/${k}/msgs/${id}`, () => cap.db.doc(`boards/${k}/msgs/${id}`).set(doc))
    .then(() => write('boards/index', () => merge('boards/index', { ch: { [k]: { at, n: (index[k]?.n || 0) + 1, last: doc.agent || 'person' } } })));
}

// ---------------------------------------------------------------- Slack bridge (read-only, the viewer's own connector)
function parseSlack(text) {
  return String(text || '').split(/\n\n+/).map(block => {
    const m = block.match(/^(.+?)\s*(?:<[^>]*>)?:\s([\s\S]*?)\s*\[(\d{4}-\d\d-\d\d [^\]]+)\]\s*$/);
    return m ? { who: m[1].replace(/​/g, '').trim(), text: m[2].replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2').replace(/<(https?:[^>]+)>/g, '$1').trim(), when: m[3] } : null;
  }).filter(Boolean);
}
function watchBridge(k) {
  unsubSlack?.(); unsubSlack = null; slack = { items: [], state: 'off', err: '' }; bridge = null; slackFor = k;
  if (!cap.db) return;
  cap.db.doc(`bridges/${k}`).get().then(s => {
    if (slackFor !== k) return;
    bridge = s.exists ? s.data() : null;
    if (!bridge || !cap.mcp) { render(); return; }
    slack.state = 'loading'; render();
    unsubSlack = cap.mcp.watchTool('Slack', 'slack_read_channel', { channel_id: bridge.id, limit: 20, response_format: 'concise' }, ev => {
      if (ev.type === 'data') { const p = ev.result.payload; slack = { items: parseSlack(typeof p === 'string' ? p : p?.messages), state: 'live', err: '', at: ev.result.cache?.storedAt || Date.now() }; }
      else { const c = ev.error.code; slack = { items: ['server_unavailable', 'upstream_error'].includes(c) ? slack.items : [], state: 'error', err: c === 'server_not_connected' ? 'Add Slack in claude.ai Settings → Connectors to see this channel.' : c === 'needs_reauth' ? 'Reconnect Slack in claude.ai Settings → Connectors.' : c === 'not_in_manifest' ? 'Slack is turned off for this page.' : 'Slack did not answer. It will try again.' }; }
      render();
    }, { refetchInterval: 60000 });
  }, () => {});
}
async function findSlack(q) {
  const r = await cap.mcp.callTool('Slack', 'slack_search_channels', { keywords: [q], natural_language_query: '', limit: 6, response_format: 'concise' });
  const text = typeof r.payload === 'string' ? r.payload : r.payload?.results || '';
  return [...String(text).matchAll(/#([\w.-]+) \(([A-Z0-9]+)\)/g)].map(m => ({ name: m[1], id: m[2] }));
}

// ---------------------------------------------------------------- graph tools the agents use
const brief = n => n && { slug: n.s, title: n.t, kind: n.k };
const TOOLS = [
  { name: 'find_concepts', description: 'Search concepts by words in their title or slug. Returns up to 8 {slug, title, kind}.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: ({ query }) => { const q = String(query || '').toLowerCase().split(/\s+/).filter(Boolean); return nodes.map(n => ({ n, s: q.filter(w => (n.t + ' ' + n.s).toLowerCase().includes(w)).length })).filter(x => x.s).sort((a, b) => b.s - a.s).slice(0, 8).map(x => brief(x.n)); } },
  { name: 'get_concept', description: 'One concept: title, kind, description, code path, its domain, what it contains, what contains it, what it depends on and what depends on it.', inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    execute: ({ slug }) => { const n = byId.get(String(slug)); if (!n) throw new Error('no concept ' + slug); const dependedBy = A.edges.filter(e => e.y === 'd' && e.B === n).map(e => e.A);
      return { ...brief(n), description: String(n.desc || '').slice(0, 600), path: n.p || null, domain: A.domainOf(n)?.s || null, contains: A.contents(n).slice(0, 24).map(x => x.s), containedBy: A.containers(n).map(x => x.s), dependsOn: A.dependsOn(n).map(x => x.s), dependedBy: dependedBy.slice(0, 24).map(x => x.s), revisions: n.revs }; } },
  { name: 'impact', description: 'Everything a change to this concept reaches (what depends on it and what it contains), with hop counts. Returns {total, byHop: [[slug, ...], ...]}.', inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    execute: ({ slug }) => { const n = byId.get(String(slug)); if (!n) throw new Error('no concept ' + slug); const r = A.reach(n), by = []; for (const x of r.order.slice(1)) (by[r.hop.get(x) - 1] ??= []).push(x.s); return { total: r.order.length - 1, byHop: by.map(l => l.slice(0, 16)) }; } },
  { name: 'path', description: 'Shortest chain of relations between two concepts, as a list of slugs, or null.', inputSchema: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] },
    execute: ({ from, to }) => { const a = byId.get(String(from)), b = byId.get(String(to)); if (!a || !b) throw new Error('unknown slug'); return A.path(a, b)?.nodes.map(x => x.s) ?? null; } },
  { name: 'code_graph', description: 'What code-graph-rag parsed for one concept: its functions, the files that call it and that it calls, tests that exercise it, and code edges to other concepts the vault does not declare.', inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    execute: ({ slug }) => { const g = A.cgr?.concepts[String(slug)]; if (!g) throw new Error('no parsed module for ' + slug);
      const e = (A.codeEdges || []).filter(x => x.a === slug || x.b === slug).map(x => ({ other: x.a === slug ? x.b : x.a, direction: x.a === slug ? 'calls' : 'called_by', calls: x.calls, imports: x.imports, declaredInVault: x.declared }));
      return { path: g.path, definitions: g.defines.slice(0, 10).map(d => `${d.name}:${d.start}`), calledBy: g.calledBy.slice(0, 6), callsInto: g.callsOut.slice(0, 6), testCalls: g.testCalls, conceptEdges: e }; } },
  { name: 'semantic_search', description: 'Rank concepts by meaning for a free-text query, over page text and parsed code identifiers. Returns up to 8 {slug, title, matched}.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    execute: ({ query }) => (A.semanticSearch?.(String(query || '')) || []).map(r => ({ slug: r.n.s, title: r.n.t, matched: r.hit })) },
  { name: 'history', description: 'Recent commits that changed this concept\'s page or code, newest first: hash, date, subject, lines added/removed, whether the page changed, and concepts reached by calls.', inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
    execute: ({ slug }) => (A.timeline?.commits || []).filter(c => c.n.includes(slug) || c.code.includes(slug)).slice(-8).reverse().map(c => ({ hash: c.h, date: c.d.slice(0, 10), subject: c.s, add: c.add, del: c.del, pageChanged: c.n.includes(slug), reaches: c.reach.slice(0, 6) })) },
  { name: 'read_channel', description: 'The latest messages in this channel, oldest first, including other agents. Use it to answer what was said.', inputSchema: { type: 'object', properties: {} },
    execute: () => transcript(20) },
];
const slackTool = { name: 'read_slack', description: 'The latest messages of the Slack channel bridged into this board (read-only).', inputSchema: { type: 'object', properties: {} }, execute: () => slack.items.slice(0, 15).map(m => `${m.who}: ${m.text.slice(0, 300)}`) };
function transcript(n) { return msgs.slice(-n).map(m => `${m.agent ? AGENTS[m.agent]?.name || m.agent : nameOf(m.by) || 'A person'} (${m.kind}): ${m.text.slice(0, 600)}`); }
function whoIsWhere() { return peers.filter(p => p.presence?.at).map(p => `${p.isMe ? 'the viewer' : 'a colleague'} is looking at ${p.presence.at}`).slice(0, 12); }

async function setAgent(a, state, on) {
  if (!cap.db) return;
  await write('agents/status', () => merge('agents/status', { [a]: { state, on: on || null, at: Date.now() } }));
}
function context(k) {
  const n = byId.get(slugOfKey(k)), sel = A.selected;
  return [
    `This is Ontology Atlas: a graph of ${nodes.length} concepts (domains contain capabilities, capabilities contain elements; capabilities depend on each other).`,
    `Domains: ${nodes.filter(x => x.k === 'domain').map(x => x.s).join(', ')}.`,
    n ? `The channel is about [[${n.s}]] (${n.k}, "${n.t}").` : 'The channel is #general.',
    sel && sel !== n ? `The viewer currently has [[${sel.s}]] selected.` : '',
    `People here now: ${whoIsWhere().join('; ') || 'only the viewer'}.`,
    `Recent messages:\n${transcript(12).join('\n') || '(none)'}`,
    'Refer to concepts ONLY by slugs that exist, written as [[slug]]. Use the tools to check; never invent a slug.',
  ].filter(Boolean).join('\n');
}
const SHAPE = 'Reply with only JSON: {"say": string (at most 110 words, plain text, concepts as [[slug]]), "steps": [{"do": string, "concepts": [slug]}] (0-6 items), "focus": slug or null}.';

async function runAgent(a, k, task, kind) {
  const ctl = new AbortController(); busy = { agent: a, ctl, k }; render();
  const tools = bridge && slack.items.length ? [...TOOLS, slackTool] : TOOLS;
  try {
    await setAgent(a, 'thinking', slugOfKey(k) || A.selected?.s);
    const out = await cap.sample.json(`You are the ${AGENTS[a].name} agent on a shared board: you ${AGENTS[a].role}.\n${context(k)}\n\nTask: ${task}\n\n${SHAPE}`, { tools, modelTier: tier, signal: ctl.signal });
    const steps = Array.isArray(out?.steps) ? out.steps.map(s => ({ do: String(s?.do || '').slice(0, 300), concepts: (Array.isArray(s?.concepts) ? s.concepts : []).map(String).filter(x => byId.has(x)).slice(0, 6) })).filter(s => s.do) : [];
    const say = String(out?.say || '').trim() || '(no answer)';
    const refs = [...new Set([...(byId.has(out?.focus) ? [out.focus] : []), ...refsIn(say), ...steps.flatMap(s => s.concepts)])].slice(0, 12);
    await post(k, { agent: a, kind, text: say, steps, refs });
    return { say, steps };
  } catch (e) {
    if (e?.code === 'not_granted' || e?.code === 'sampling_disabled' || e?.code === 'not_declared') { cap.sample = null; setNotice('Agents are off for this view.'); }
    else if (e?.code === 'tools_unavailable') setNotice('This viewer cannot give agents graph tools, so they stay quiet.');
    else if (e?.code === 'rate_limited') setNotice('Agent usage is at its limit for now. Try again later.');
    else if (e?.code !== 'cancelled') setNotice(e?.code === 'invalid_json' ? `${AGENTS[a].name} answered in the wrong shape. Try again.` : `${AGENTS[a].name} could not finish. Try again.`);
    return null;
  } finally { busy = null; await setAgent(a, 'idle', null); render(); }
}
// Plan, critique, reflect: three agents messaging each other through the channel.
async function convene(k, goal) {
  const lock = await cap.db?.doc(`locks/${k}`).acquire({ holder: me.id || uid(), ttlMs: 180000 }).catch(() => ({ acquired: true }));
  if (lock && !lock.acquired) { setNotice('Agents are already working in this channel.'); return; }
  const g = goal || `Plan the next change to [[${slugOfKey(k) || A.selected?.s || nodes[0].s}]].`;
  const plan = await runAgent('planner', k, `Goal: ${g}\nWrite a plan. Call impact on the concepts you would change and name what the change reaches.`, 'plan'); if (!plan) return;
  const crit = await runAgent('reviewer', k, `Review the Planner's latest plan (read_channel). Find what it misses: dependents it will break, cycles, concepts a colleague is looking at now. Be specific.`, 'critique'); if (!crit) return;
  await runAgent('planner', k, 'Reflect on the Reviewer\'s critique (read_channel). Say what you got wrong, then give the revised plan.', 'reflection');
}

// ---------------------------------------------------------------- map overlay: people and agents where they are
A.hooks.overlay.push((g, t, spos) => {
  const now = performance.now();
  const drawRing = (n, col, label, dash, i) => {
    const p = spos(n); if (p.x < -40 || p.y < -40) return;
    const r = 18 + i * 6;
    g.save(); g.strokeStyle = col; g.lineWidth = 1.6; g.globalAlpha = 0.95;
    if (dash) { g.setLineDash([4, 5]); g.lineDashOffset = -t / 40; }
    g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.font = '500 10.5px "Geist Mono", ui-monospace, monospace'; g.textAlign = 'left'; g.textBaseline = 'middle';
    const w = g.measureText(label).width + 12, lx = p.x + r * 0.72, ly = p.y - r * 0.72;
    g.fillStyle = 'rgba(10,10,10,0.92)'; g.strokeStyle = col; g.lineWidth = 1;
    g.beginPath(); g.roundRect(lx, ly - 9, w, 18, 9); g.fill(); g.stroke();
    g.fillStyle = '#fafafa'; g.fillText(label, lx + 6, ly + 0.5); g.restore();
  };
  const at = new Map();
  for (const p of peers) { const n = byId.get(String(p.presence?.at || '')); if (!n || p.sameTab) continue; const i = at.get(n) || 0; at.set(n, i + 1); drawRing(n, String(p.presence.col || '#d4d4d4'), nameOf(p.by || p.presence.id) || 'Someone', false, i); }
  for (const [a, s] of Object.entries(agentState)) { const n = byId.get(String(s?.on || '')); if (!n || s.state !== 'thinking' || Date.now() - s.at > 180000) continue; const i = at.get(n) || 0; at.set(n, i + 1); drawRing(n, '#8f8f8f', `${AGENTS[a]?.name || a} · thinking`, true, i); }
  for (let i = pings.length - 1; i >= 0; i--) {
    const k = (now - pings[i].t0) / 1600; if (k > 1) { pings.splice(i, 1); continue; }
    const n = byId.get(pings[i].s), p = spos(n);
    g.save(); g.strokeStyle = pings[i].col; g.globalAlpha = 1 - k; g.lineWidth = 2;
    for (const d of [0, 0.25]) { const kk = Math.max(0, k - d); g.beginPath(); g.arc(p.x, p.y, 10 + kk * 70, 0, Math.PI * 2); g.stroke(); }
    g.restore();
  }
});

// ---------------------------------------------------------------- drawer
A.hooks.drawer.push((el, close) => {
  drawerEl = el; _closeDrawer = close;
  if (followSel && A.selected && keyOf(A.selected.s) !== channel) { channel = keyOf(A.selected.s); openChannel(channel); }
  el.innerHTML = `<header><div class="kind">Live</div><h2>People, channels and agents on this graph</h2><button class="close" aria-label="Close live">${CLOSE}</button></header><div class="dbody live"></div>`;
  el.querySelector('.close').onclick = () => { drawerEl = null; close(); };
  render();
});
const CLOSE = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
const chip = s => { const n = byId.get(s); return n ? `<button class="lchip" data-go="${esc(s)}"><b class="${n.k}"></b>${esc(n.t)}</button>` : esc(s); };
const richText = t => esc(t).replace(/\[\[([^\]]+)\]\]/g, (_, s) => byId.has(s) ? chip(s) : esc(s));
const avatar = (col, label) => `<span class="lav" style="--c:${esc(col)}">${esc((label || '?').trim()[0] || '?').toUpperCase()}</span>`;

let draft = '';
function render(scrollEnd) {
  if (!drawerEl || A.drawer !== 'live') return;
  const body = drawerEl.querySelector('.dbody.live'); if (!body) return;
  const box = body.querySelector('textarea'); if (box) draft = box.value;
  const hadFocus = document.activeElement === box;
  const feed0 = body.querySelector('.lfeed'), atEnd = !feed0 || feed0.scrollHeight - feed0.scrollTop - feed0.clientHeight < 40;
  const n = byId.get(slugOfKey(channel));
  const live = !!(cap.room || cap.db);
  const people = peers.length ? peers : [{ isMe: true, sameTab: true, presence: { at: A.selected?.s, col: me.color }, by: me.id }];
  const chans = Object.entries(index).sort((a, b) => b[1].at - a[1].at).slice(0, 10);
  body.innerHTML = `
    ${live ? '' : `<p class="m lnote">Open this page in claude.ai to see who else is here, keep channels and run agents. Everything else works on its own.</p>`}
    ${notice ? `<p class="m lnote">${esc(notice)} <button class="linkish" data-x="notice">Dismiss</button></p>` : ''}
    <section class="dsec"><h3>Here now · ${people.length}</h3><div class="lpeople">${people.map(p => { const at = byId.get(String(p.presence?.at || '')); const nm = p.isMe ? `${nameOf(p.by) || me.name || 'You'} (you)` : nameOf(p.by || p.presence?.id) || 'Someone'; return `<button class="lperson" ${at ? `data-go="${esc(at.s)}"` : 'disabled'} title="${at ? 'Go to what they are looking at' : ''}">${avatar(p.presence?.col || '#8f8f8f', nm)}<span><b>${esc(nm)}</b><small>${at ? esc(at.t) : 'looking around'}${p.guest ? ' · guest' : ''}</small></span></button>`; }).join('')}
      ${Object.entries(AGENTS).map(([a, d]) => { const s = agentState[a]; const on = s?.state === 'thinking' && Date.now() - s.at < 180000 ? byId.get(s.on) : null; return `<div class="lagent ${on ? 'on' : ''}" title="${esc(d.role)}"><span class="ldot"></span><span><b>${d.name}</b>${on ? `<small>thinking about ${esc(on.t)}</small>` : cap.sample ? '' : '<small>off</small>'}</span></div>`; }).join('')}</div></section>
    <section class="lchanrow"><div class="lchans"><button class="lch" aria-pressed="${channel === 'general'}" data-ch="general"># general</button>${n && channel !== 'general' ? `<button class="lch" aria-pressed="true" data-ch="${esc(channel)}"># ${esc(n.t)}</button>` : ''}${chans.filter(([k]) => k !== channel && k !== 'general').map(([k, v]) => `<button class="lch" aria-pressed="false" data-ch="${esc(k)}"># ${esc(titleOfKey(k))} <small>${v.n}</small></button>`).join('')}</div>
      <label class="lfollow"><input type="checkbox" ${followSel ? 'checked' : ''} data-x="follow"> Follow my selection</label></section>
    <section class="lfeedwrap"><div class="lfeed" aria-live="polite">${msgs.length ? msgs.map(m => { const who = m.agent ? AGENTS[m.agent]?.name || m.agent : nameOf(m.by) || 'Someone'; return `<article class="lmsg ${m.agent ? 'agent' : ''} k-${esc(m.kind)}"><header>${m.agent ? `<span class="lav agent">${esc(who[0])}</span>` : avatar('#8f8f8f', who)}<b>${esc(who)}</b>${m.kind !== 'msg' ? `<span class="ltag">${esc(m.kind)}</span>` : ''}<time>${ago(m.at)}</time></header><div class="ltext">${richText(m.text)}</div>${m.steps?.length ? `<ol class="lsteps">${m.steps.map(s => `<li>${richText(s.do)}${s.concepts.length ? `<div>${s.concepts.map(chip).join('')}</div>` : ''}</li>`).join('')}</ol>` : ''}${m.agent && m.steps?.length && (canSendClaude === 'available' || canSendClaude === 'available_if_summoned') ? `<button class="btn lhand" data-hand="${esc(m.id)}">Hand to my Claude</button>` : ''}</article>`; }).join('') : `<p class="m">${cap.db ? `Nothing said in # ${esc(titleOfKey(channel))} yet.` : 'Channels need the page opened in claude.ai.'}</p>`}
    </div></section>
      ${bridge ? `<div class="lslack"><h4>Slack · #${esc(bridge.name)} <small>${slack.state === 'live' ? `read-only · ${ago(slack.at)}` : slack.state === 'loading' ? 'reading…' : ''}</small> <button class="linkish" data-x="unbridge">Remove</button></h4>${slack.err ? `<p class="m">${esc(slack.err)}</p>` : ''}${slack.items.slice(0, 8).reverse().map(s => `<div class="lsm"><b>${esc(s.who)}</b> <time>${esc(s.when)}</time><div>${esc(s.text.slice(0, 400))}</div></div>`).join('')}</div>` : ''}
    ${cap.db ? `<section class="lcompose"><textarea rows="2" placeholder="Message # ${esc(titleOfKey(channel))} · @planner @reviewer @cartographer · [[slug]] links a concept">${esc(draft)}</textarea>
      <div class="lrow"><button class="btn primary" data-x="send">Send</button>${cap.sample ? `<button class="btn" data-x="convene" ${busy ? 'disabled' : ''} title="Planner plans, Reviewer critiques, Planner reflects">Convene agents</button>` : ''}${cap.room ? `<button class="btn" data-x="ping" ${A.selected ? '' : 'disabled'} title="Everyone here sees a ripple on your selection">Point everyone here</button>` : ''}<span class="grow"></span>${busy ? `<button class="btn" data-x="stop">Stop ${esc(AGENTS[busy.agent].name)}</button>` : cap.sample ? `<select data-x="tier" aria-label="Agent depth"><option value="quick" ${tier === 'quick' ? 'selected' : ''}>Quick</option><option value="default" ${tier === 'default' ? 'selected' : ''}>Thorough</option></select>` : ''}</div>
      ${cap.mcp && !bridge ? `<div class="lrow lbridge">${bridge ? '' : `<input placeholder="Bridge a Slack channel (name)" data-x="slackq"><button class="btn" data-x="slackfind">Find</button>`}</div><div class="lslackhits"></div>` : ''}
    </section>` : ''}`;
  body.scrollTop = 0; body.onscroll = () => { body.scrollTop = 0; }; // the feed scrolls, never the panel
  const feed = body.querySelector('.lfeed');
  if (feed && (scrollEnd ? atEnd : true)) feed.scrollTop = feed.scrollHeight;
  const ta = body.querySelector('textarea'); if (ta && hadFocus) { ta.focus(); ta.selectionStart = ta.selectionEnd = ta.value.length; }
  wire(body);
}
function wire(body) {
  body.querySelectorAll('[data-go]').forEach(b => b.onclick = () => A.goTo(byId.get(b.dataset.go)));
  body.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { channel = b.dataset.ch; followSel = false; openChannel(channel); });
  const on = (x, ev, fn) => { const el = body.querySelector(`[data-x=${x}]`); if (el) el[ev] = fn; };
  on('follow', 'onchange', e => { followSel = e.target.checked; if (followSel && A.selected) { channel = keyOf(A.selected.s); openChannel(channel); } });
  on('notice', 'onclick', () => { notice = ''; render(); });
  on('tier', 'onchange', e => { tier = e.target.value; });
  on('stop', 'onclick', () => busy?.ctl.abort());
  on('ping', 'onclick', () => { const n = A.selected; if (n) cap.room.emit('ping', { s: n.s, col: me.color, id: me.id }).catch(e => setNotice(e?.code === 'not_permitted' ? 'Only people who can interact may point.' : 'Could not reach the room.')); });
  const ta = body.querySelector('textarea');
  const send = async () => {
    const text = ta.value.trim(); if (!text) return;
    ta.value = ''; draft = '';
    const k = channel;
    await post(k, { text });
    const m = text.match(/@(planner|reviewer|cartographer)\b/i);
    if (m && cap.sample && !busy) runAgent(m[1].toLowerCase(), k, `A person asked: "${text.replace(/@\w+/g, '').trim().slice(0, 800)}". Answer them using the tools.`, 'answer');
  };
  on('send', 'onclick', send);
  if (ta) ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } e.stopPropagation(); };
  on('convene', 'onclick', () => { const goal = ta?.value.trim(); if (goal) { ta.value = ''; draft = ''; post(channel, { text: goal, kind: 'goal' }); } convene(channel, goal); });
  body.querySelectorAll('[data-hand]').forEach(b => b.onclick = () => {
    const m = msgs.find(x => x.id === b.dataset.hand); if (!m) return;
    const clean = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F­​-‏‪-‮⁠-⁤﻿]/g, '').slice(0, 600);
    cap.room.sendToClaudeSession({ label: `${AGENTS[m.agent]?.name || 'Agent'} ${m.kind} · ${titleOfKey(channel)}`, channel: titleOfKey(channel), concept: slugOfKey(channel), kind: m.kind, summary: clean(m.text), steps: (m.steps || []).map(s => ({ do: clean(s.do), concepts: s.concepts })) }, { deliver: 'stage' })
      .then(() => A.flash('In your Claude chat. Send it when ready.'), () => setNotice('Your Claude is not open beside this page.'));
  });
  on('slackfind', 'onclick', async () => {
    const q = body.querySelector('[data-x=slackq]').value.trim().replace(/^#/, ''); if (!q) return;
    const hits = body.querySelector('.lslackhits'); hits.textContent = 'Searching Slack…';
    try { const found = await findSlack(q); hits.innerHTML = found.length ? found.map(f => `<button class="lch" data-slack="${esc(f.id)}" data-name="${esc(f.name)}"># ${esc(f.name)}</button>`).join('') : '<span class="m">No channel by that name.</span>';
      hits.querySelectorAll('[data-slack]').forEach(b => b.onclick = async () => { const k = channel; await write(`bridges/${k}`, () => cap.db.doc(`bridges/${k}`).set({ id: b.dataset.slack, name: b.dataset.name, by: me.id, at: Date.now() })); watchBridge(k); });
    } catch (e) { hits.textContent = e?.code === 'server_not_connected' ? 'Add Slack in claude.ai Settings → Connectors first.' : e?.code === 'not_in_manifest' ? 'Slack is turned off for this page.' : 'Slack did not answer.'; }
  });
  on('unbridge', 'onclick', async () => { const k = channel; await write(`bridges/${k}`, () => cap.db.doc(`bridges/${k}`).delete()); watchBridge(k); });
}
// ---------------------------------------------------------------- live infrastructure (optional)
// Services to show come from the build (`atlas-current build --services <file.json>`), never from this
// source: [{ key, label, role, projectId, serviceId }]. They are read through the viewer's own Railway
// connector (describe-service, read-only) when the page runs where connectors exist. Nothing here can
// change a service; the page shows state, the last deployment and what the service builds from.
const SERVICES = (() => {
  try {
    const list = JSON.parse(document.getElementById('atlas-meta')?.textContent || '{}').services;
    return Array.isArray(list) ? list.filter(s => s && s.key && s.projectId && s.serviceId) : [];
  } catch { return []; }
})();
const conn = Object.fromEntries(SERVICES.map(s => [s.key, { state: 'waiting' }]));
let connEl = null, connWatching = false;
function watchConnections() {
  if (connWatching || !cap.mcp || !SERVICES.length) return; connWatching = true;
  for (const s of SERVICES) {
    cap.mcp.watchTool('Railway', 'describe-service', { projectId: s.projectId, serviceId: s.serviceId }, ev => {
      if (ev.type === 'data') {
        const p = ev.result.payload || {}, d = p.latestDeployment || {};
        conn[s.key] = { state: 'ok', live: p.service?.state, deploy: d.status, at: d.createdAt, repo: p.config?.source?.repo, branch: p.config?.source?.branch, domain: p.domains?.serviceDomains?.[0]?.domain, stored: ev.result.cache?.storedAt || Date.now() };
      } else {
        const c = ev.error.code;
        conn[s.key] = { state: 'error', err: c === 'server_not_connected' ? 'Add Railway in claude.ai Settings → Connectors.' : c === 'needs_reauth' ? 'Reconnect Railway in claude.ai Settings → Connectors.' : c === 'not_in_manifest' ? 'Railway is turned off for this page.' : 'Railway did not answer.' };
      }
      paintConnections();
    }, { refetchInterval: 120000 });
  }
}
function paintConnections() {
  if (!connEl?.isConnected) return;
  const g = A.cgr?.source;
  const row = s => { const c = conn[s.key]; const ok = c.state === 'ok' && c.deploy === 'SUCCESS';
    return `<div class="conn-row"><span class="conn-dot ${c.state === 'ok' ? (ok ? 'up' : 'warn') : c.state === 'error' ? 'down' : ''}"></span><div><b>${esc(s.label)}</b><small>${esc(s.role)}</small>
      ${c.state === 'ok' ? `<small class="mono">${esc(c.deploy || 'no deployment')} · ${c.at ? esc(new Date(c.at).toISOString().slice(0, 16).replace('T', ' ')) + ' UTC' : ''}${c.repo ? ` · builds ${esc(c.repo)}@${esc(c.branch || '')}` : ''}</small>` : c.state === 'error' ? `<small>${esc(c.err)}</small>` : `<small>${cap.mcp ? 'reading…' : 'Open in claude.ai with the Railway connector to see live status.'}</small>`}</div>
      ${c.state === 'ok' ? `<time>${ago(c.stored)}</time>` : ''}</div>`; };
  connEl.innerHTML = `<h4>Connections <span>live via Railway</span></h4>${SERVICES.map(row).join('')}
    ${g ? `<div class="conn-row"><span class="conn-dot up"></span><div><b>Graph in this page</b><small class="mono">code-graph-rag ${esc(g.version)} index of ${esc((g.commit || '').slice(0, 7))} · ${g.nodes.toLocaleString()} nodes · sha ${esc(g.sha256)}</small><small>Built with the same analyzer as the service; the service answers live queries, this page carries a snapshot.</small></div></div>` : ''}`;
}
window.__atlasConn = { mount(el) { connEl = el; watchConnections(); paintConnections(); } };

setInterval(() => { if (A.drawer === 'live' && document.activeElement?.tagName !== 'TEXTAREA' && document.activeElement?.tagName !== 'INPUT') render(true); }, 30000); // refresh relative times
})();
