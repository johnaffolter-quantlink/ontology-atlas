// Trace every route of the app down to its code, contracts, decisions and meaning.
// Reads this repository only; writes trace.json.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';


export async function extractTrace(ctx, vault) {
const repo = ctx.repo;
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const files = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean);
const codeFiles = new Set(files.filter(f => /^(src|app)\/.*\.(tsx?|mjs)$/.test(f) && !/\.(test|spec|perf\.test|stories)\.tsx?$/.test(f) && !/\.test\./.test(f)));

// ---------- import graph
// tsconfig path aliases, most specific first ('@/app-providers/*' before '@/*')
const tsPaths = Object.entries(JSON.parse(read('tsconfig.json')).compilerOptions.paths)
  .map(([k, [v]]) => [k.replace(/\*$/, ''), v.replace(/^\.\//, '').replace(/\*$/, '')]).sort((a, b) => b[0].length - a[0].length);
function resolve(from, spec) {
  let base;
  const alias = tsPaths.find(([k]) => spec.startsWith(k));
  if (alias) base = alias[1] + spec.slice(alias[0].length);
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const c of [base, base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx']) if (codeFiles.has(c)) return c;
  return null;
}
const importsOf = new Map();
const src = new Map();
for (const f of codeFiles) {
  const t = read(f); src.set(f, t);
  const out = new Set();
  for (const m of t.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g)) { const r = resolve(f, m[1]); if (r) out.add(r); }
  importsOf.set(f, [...out]);
}

// ---------- slices (FSD layer/slice), the unit a person reasons about
function sliceOf(f) {
  const m = f.match(/^src\/(app|views|widgets|features|entities|shared)\/([^/]+)/);
  if (!m) return null;
  if (m[1] === 'shared') return null; // shared primitives are plumbing, not a place in the product
  if (m[1] === 'app') return `views/${m[2]}`; // app-provider workspaces compose views; they sit in the view column
  return `${m[1]}/${m[2]}`;
}

// ---------- labels: resolve t('key') through messages/en.json
const messages = JSON.parse(read('messages/en.json'));
const walk = parts => { let cur = messages; for (const part of parts) { if (cur && typeof cur === 'object' && part in cur) cur = cur[part]; else return null; } return typeof cur === 'string' ? cur : null; };
const lookup = (ns, key) => walk([...(ns ? ns.split('.') : []), ...key.split('.')]) ?? walk(key.split('.')) ?? Object.keys(messages).map(top => walk([top, ...key.split('.')])).find(Boolean) ?? null;
function controlsIn(f) {
  const t = src.get(f); if (!f.endsWith('.tsx')) return [];
  const namespaces = [...t.matchAll(/(?:useTranslations|getTranslations)\(\s*['"]([^'"]+)['"]/g)].map(m => ({ at: m.index, ns: m[1] }));
  const nsAt = i => { let ns = null; for (const n of namespaces) if (n.at < i) ns = n.ns; return ns ?? namespaces[0]?.ns ?? null; };
  const out = [];
  const re = /<(button|Button|IconButton|ToolbarButton|MenuItem)\b([\s\S]{0,900}?)>([\s\S]{0,400}?)<\/\1>/g;
  for (const m of t.matchAll(re)) {
    const attrs = m[2], body = m[3], ns = nsAt(m.index);
    const tl = s => { const k = s.match(/\bt\(\s*['"]([^'"]+)['"]/); return k ? lookup(ns, k[1]) || `key:${k[1]}` : null; };
    const aria = attrs.match(/aria-label=\{([^}]+)\}/)?.[1] || attrs.match(/aria-label="([^"]+)"/)?.[1];
    let label = aria ? (tl(aria) || (/^[A-Za-z]/.test(aria) && !aria.includes('(') ? aria : null)) : null;
    if (!label) label = tl(body);
    if (!label) { const txt = body.replace(/<[^>]+>/g, ' ').replace(/\{[^}]*\}/g, ' ').replace(/\s+/g, ' ').trim(); if (/^[A-Za-z][\w .,'’&/-]{1,40}$/.test(txt)) label = txt; }
    const handler = attrs.match(/onClick=\{\s*(?:\(\)\s*=>\s*)?([A-Za-z_$][\w$.]*)/)?.[1] || null;
    const line = t.slice(0, m.index).split('\n').length;
    if (label || handler) out.push({ label: label ? String(label).replace(/\s+/g, ' ').slice(0, 60) : null, handler, file: f, line });
  }
  return out;
}

// ---------- contracts
const registry = read('mcp/src/server/registry.mjs');
const mcpTools = [...new Set([...registry.matchAll(/name: '([a-z_]+)'/g)].map(m => m[1]))];
const mcpSet = new Set(mcpTools);
function contractsIn(f) {
  const t = src.get(f), out = [];
  for (const m of t.matchAll(/invoke(?:<[^>]*>)?\(\s*['"]([a-z_]+)['"]/g)) out.push(`desktop:${m[1]}`);
  for (const m of t.matchAll(/['"]([a-z]+(?:_[a-z]+)+)['"]/g)) if (mcpSet.has(m[1])) out.push(`mcp:${m[1]}`);
  for (const m of t.matchAll(/['"`]([\w./-]*\.jsonl)['"`]/g)) out.push(`jsonl:${m[1].split('/').pop()}`);
  return [...new Set(out)];
}
const kindOfModule = f => /intent/i.test(path.basename(f)) ? 'intent' : /prompt/i.test(path.basename(f)) ? 'prompt' : null;

// ---------- routes
const pages = files.filter(f => /^app\/\[locale\]\/.*page\.tsx$/.test(f) || f === 'app/[locale]/page.tsx');
const routes = pages.map(f => {
  const r = '/' + f.replace(/^app\/\[locale\]\/?/, '').replace(/\/?page\.tsx$/, '');
  const t = src.get(f) || read(f);
  // A redirect route renders a *-redirect view; its canonical names where it sends people.
  const isRedirect = /from\s+['"]@\/views\/[\w-]+-redirect['"]/.test(t);
  const canon = t.match(/absoluteUrl\(\s*`\/\$\{locale\}(\/[^`]*?)\/?`/)?.[1];
  const redirectTo = isRedirect ? (canon || '(computed)') : null;
  return { path: r === '/' ? '/' : r.replace(/\/$/, ''), file: f, redirect: redirectTo };
}).sort((a, b) => a.path.localeCompare(b.path));

// ---------- nodes and edges
const nodes = new Map(), edges = new Map();
const node = (id, kind, props = {}) => { if (!nodes.has(id)) nodes.set(id, { id, kind, files: new Set(), controls: [], ...props }); return nodes.get(id); };
const edge = (a, b) => { if (a === b) return; edges.set(`${a}>${b}`, { a, b }); };

for (const r of routes) {
  const rid = `route:${r.path}`;
  node(rid, 'route', { label: r.path, redirect: r.redirect }).files.add(r.file);
  // walk the page's import closure; attribute each file to its slice; slice→slice edges follow imports across slices
  const seen = new Set([r.file]), q = [r.file];
  const firstSlices = new Set();
  while (q.length) {
    const f = q.shift();
    const fs0 = sliceOf(f);
    for (const g of importsOf.get(f) || []) {
      const gs = sliceOf(g);
      const mk = kindOfModule(g);
      if (mk) { node(`${mk}:${g}`, mk, { label: path.basename(g).replace(/\.(tsx?|mjs)$/, '') }).files.add(g); edge(fs0 ? `slice:${fs0}` : rid, `${mk}:${g}`); }
      if (gs && gs !== fs0) { if (!fs0) firstSlices.add(gs); else edge(`slice:${fs0}`, `slice:${gs}`); }
      if (!seen.has(g)) { seen.add(g); q.push(g); }
    }
  }
  for (const s of firstSlices) edge(rid, `slice:${s}`);
  for (const f of seen) {
    const s = sliceOf(f); if (!s) continue;
    const n = node(`slice:${s}`, { views: 'view', widgets: 'widget', features: 'feature', entities: 'entity' }[s.split('/')[0]], { label: s.split('/')[1], layer: s.split('/')[0] });
    n.files.add(f);
  }
}
// controls and contracts per slice (from the slice's own files)
for (const n of nodes.values()) {
  if (!n.id.startsWith('slice:')) continue;
  for (const f of n.files) {
    n.controls.push(...controlsIn(f));
    for (const c of contractsIn(f)) { const [k, name] = c.split(':'); node(c, k, { label: name }); edge(n.id, c); }
  }
}
// intents/prompts reach contracts too
for (const n of nodes.values()) if (n.kind === 'intent' || n.kind === 'prompt') for (const f of n.files) for (const c of contractsIn(f)) { const [k, name] = c.split(':'); node(c, k, { label: name }); edge(n.id, c); }

// ---------- decisions naming a route
const decDir = 'docs/records/decisions';
for (const f of files.filter(f => f.startsWith(decDir + '/') && f.endsWith('.md'))) {
  const t = read(f);
  const title = (t.match(/^##\s+\d{4}-\d{2}-\d{2}\s+[—-]\s+(.+)$/m)?.[1] || t.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] || t.match(/^#+\s+(.+)$/m)?.[1] || path.basename(f, '.md')).replace(/`/g, '').slice(0, 110);
  const date = path.basename(f).match(/\d{4}-\d{2}-\d{2}/)?.[0] || '';
  for (const r of routes) {
    if (r.path === '/') continue;
    const re = new RegExp('[`\\s(]' + r.path.replace(/[[\]/]/g, m => '\\' + m) + '(?![\\w-])');
    if (re.test(t)) { node(`decision:${f}`, 'decision', { label: title, date }).files.add(f); edge(`route:${r.path}`, `decision:${f}`); }
  }
}
// ---------- meaning: vault capabilities whose implementation path lives in a slice

for (const c of vault.nodes) {
  if (!c.p) continue;
  const s = sliceOf(c.p);
  if (s && nodes.has(`slice:${s}`)) { node(`meaning:${c.s}`, 'meaning', { label: c.t, slug: c.s }); edge(`slice:${s}`, `meaning:${c.s}`); }
}

// ---------- the product-review decision matrix, computed by the repository's own router
const po = await import(pathToFileURL(path.join(repo, 'scripts/lib/po-risk-router.mjs')).href);
const bNames = Object.keys(po.PO_BOUNDARY_SIGNALS);
const conditions = [{ id: 'none', label: 'No boundary touched' }, ...bNames.map(b => ({ id: b, label: `${b} affected`, desc: po.PO_BOUNDARY_SIGNALS[b] }))];
const matrix = {};
for (const ev of po.PO_EVIDENCE_STATES) {
  matrix[ev] = {};
  for (const ch of Object.keys(po.PO_CHANGE_SIGNALS)) {
    matrix[ev][ch] = {};
    for (const cond of conditions) {
      const boundaries = Object.fromEntries(bNames.map(b => [b, b === cond.id ? 'affected' : 'unchanged']));
      const r = po.routePoDecision({ evidence: ev, outcome: 'judge', changes: [ch], boundaries });
      matrix[ev][ch][cond.id] = { door: r.door, risk: r.primaryRisk, reviewers: r.reviewers || r.reviewerPair || r.reviewPair || null, reasons: r.routeReasons };
    }
  }
}
const sample = po.routePoDecision({ evidence: 'observed', outcome: 'judge', changes: ['public-contract'], boundaries: Object.fromEntries(bNames.map(b => [b, 'unchanged'])) });

const out = {
  generated: new Date().toISOString().slice(0, 10),
  head: execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(),
  nodes: [...nodes.values()].map(n => ({ ...n, files: [...n.files].sort(), controls: n.controls.slice(0, 80), controlCount: n.controls.length })),
  edges: [...edges.values()],
  matrix: { changes: po.PO_CHANGE_SIGNALS, evidence: po.PO_EVIDENCE_STATES, conditions, cells: matrix, sampleKeys: Object.keys(sample) },
  mcpTools,
};
return out;
}
