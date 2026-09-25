// Concepts, relations and the commits that changed each concept page, read from the vault's frontmatter.
import fs from 'node:fs';
import path from 'node:path';

export function extractVault(ctx) {
const { repo, vault: vaultRel, ref, git } = ctx; const root = path.join(repo, vaultRel);
const list = v => { if (!v) return []; v = v.trim(); if (v.startsWith('[')) return v.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean); return [v]; };
const nodes = [], edges = [], fileOf = {};
for (const dir of ['domains', 'capabilities', 'elements']) for (const f of (fs.existsSync(path.join(root, dir)) ? fs.readdirSync(path.join(root, dir)) : []).filter(f => f.endsWith('.md'))) {
  const rel = `${vaultRel}/${dir}/${f}`;
  const t = fs.readFileSync(path.join(repo, rel), 'utf8');
  const end = t.indexOf('\n---', 4); const fm = t.slice(4, end); const body = t.slice(end + 4).trim();
  const g = k => { const m = fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')); return m ? m[1].trim().replace(/^"|"$/g, '') : null; };
  const slug = g('slug');
  const notes = []; const rn = fm.match(/^relation_notes:\s*\{([\s\S]*?)\}\s*$/m);
  if (rn) for (const m of rn[1].matchAll(/([a-z-]+\/[a-z0-9-]+):\s*"((?:[^"\\]|\\.)*)"/g)) notes.push([m[1], m[2].replace(/\\"/g, '"')]);
  const pageHist = ctx.history(rel);
  const log = pageHist.map(c => `${c.h}|${c.d}|${c.s}`);
  const [h, d, ...s] = (log[0] || '||').split('|');
  // Alignment: does the declared implementation still exist, and did the code move after its page?
  const impl = g('path');
  let align = null;
  if (impl) {
    const exists = fs.existsSync(path.join(repo, impl));
    const implHist = exists ? ctx.history(impl) : [];
    const code = implHist[0] ? `${implHist[0].h}|${implHist[0].iso}|${implHist[0].s}` : '';
    const [ch, cd, ...cs] = code.split('|');
    const pageTop = pageHist[0], pageIso = pageTop?.iso;
    // commits after the page's own commit that touched the implementation
    const codeCommitsSincePage = pageTop ? implHist.filter(c => c.pos < pageTop.pos).length : 0;
    align = { exists, code: code ? { h: ch, d: cd, s: cs.join('|').replace(/\s*\(#\d+\)$/, '') } : null, page: pageIso, after: +codeCommitsSincePage };
  }
  const unc = (body.match(/## Uncertainty\n([\s\S]*?)(\n## |$)/) || [])[1];
  const uncertain = unc ? unc.split('\n').filter(l => /^\s*-\s+/.test(l)).length : 0;
  const rels = [...list(g('dependencies')), ...list(g('relates'))];
  nodes.push({ align, uncertain, relCount: rels.length, s: slug, k: g('kind'), t: g('title'), p: g('path'), by: g('created_by'), uid: g('uid'), body: body.slice(0, 2600), notes: notes.slice(0, 6), last: { h, d, s: s.join('|').replace(/\s*\(#\d+\)$/, '') }, revs: log.length, file: rel });
  fileOf[rel] = slug;
  if (dir === 'capabilities') { for (const d of list(g('domain'))) edges.push({ a: d, b: slug, y: 'c' }); for (const e of list(g('elements'))) edges.push({ a: slug, b: e, y: 'c' }); }
  for (const k of ['dependencies', 'relates']) for (const x of list(g(k))) edges.push({ a: slug, b: x, y: k === 'dependencies' ? 'd' : 'r' });
  if (dir === 'elements') { const d = g('domain'); if (d) edges.push({ a: d, b: slug, y: 'c' }); }
}
const ids = new Set(nodes.map(n => n.s));
const E = edges.filter(e => ids.has(e.a) && ids.has(e.b));
// Real change history: every commit on main that touched a concept page, oldest first.
const raw = git('log', ref, '--reverse', '--format=@@%h|%ad|%s', '--date=iso-strict', '--name-only', '--', `${vaultRel}/domains`, `${vaultRel}/capabilities`, `${vaultRel}/elements`);
const commits = [];
for (const chunk of raw.split('@@').filter(Boolean)) {
  const [head, ...files] = chunk.trim().split('\n');
  const [h, d, ...s] = head.split('|');
  const touched = [...new Set(files.map(f => fileOf[f.trim()]).filter(Boolean))];
  if (touched.length) commits.push({ h, d, s: s.join('|').replace(/\s*\(#\d+\)$/, ''), n: touched });
}
return { nodes, edges: E, commits };
}
