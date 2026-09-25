/**
 * Vault sources: parse a folder of Atlas Markdown pages into a graph, then test its connections.
 * One implementation runs in Node (tests) and in the page (bundled sources and a folder the
 * viewer picks), so every source is judged by the same code.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AtlasSources = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KIND_OF_FOLDER = { domains: 'domain', capabilities: 'capability', elements: 'element', architecture: 'architecture' };

  const unquote = v => { v = v.trim(); return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1).replace(/\\"/g, '"') : v; };

  /** Top-level frontmatter keys: scalars, inline lists `[a, b]`, and block lists (`- a`). Maps are kept raw. */
  function parseFrontmatter(text) {
    const t = String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    if (!t.startsWith('---\n')) return { error: 'no frontmatter (the file must start with ---)' };
    const end = t.indexOf('\n---', 4);
    if (end < 0) return { error: 'frontmatter is not closed with ---' };
    const lines = t.slice(4, end).split('\n'), data = {};
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
      if (!m) continue;
      const key = m[1]; let v = m[2];
      if (v === '' || v === '|' || v === '>') {
        const items = [];
        while (i + 1 < lines.length && /^\s+(-\s+)?\S/.test(lines[i + 1])) { const b = lines[++i].match(/^\s+-\s+(.*)$/); if (b) items.push(unquote(b[1])); }
        data[key] = items.length ? items : '';
      } else if (v.startsWith('[')) {
        data[key] = v.replace(/^\[|\]\s*$/g, '').split(',').map(unquote).filter(Boolean);
      } else if (v.startsWith('{')) {
        data[key] = { raw: v };
      } else data[key] = unquote(v);
    }
    return { data, body: t.slice(end + 4).replace(/^\n+/, '') };
  }

  const asList = v => Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : [];

  /**
   * files: [{ path, text }]. Returns nodes, edges (only those whose ends exist), and what did not
   * resolve, so a test can report it instead of the graph silently dropping it.
   */
  function parseVault(files, name) {
    const nodes = [], problems = [], rawEdges = [], seen = new Map(), profiles = [];
    for (const f of files) {
      if (!/\.md$/i.test(f.path) || /(^|\/)(README|AGENTS|CLAUDE|project)\.md$/i.test(f.path) || /(^|\/)(wiki|\.[^/]+)\//.test(f.path)) continue;
      const folder = (f.path.match(/(?:^|\/)(domains|capabilities|elements|architecture)\/[^/]+\.md$/i) || [])[1];
      const fm = parseFrontmatter(f.text);
      if (fm.error) { if (folder) problems.push({ file: f.path, issue: fm.error }); continue; }
      const d = fm.data;
      if (d.architecture_schema) { profiles.push({ file: f.path, slug: d.profile_slug, title: d.title }); continue; } // an architecture profile, not a concept page
      const kind = d.kind || KIND_OF_FOLDER[folder];
      if (!kind) continue; // not a concept page
      if (!d.slug) { problems.push({ file: f.path, issue: 'no slug' }); continue; }
      const para = (fm.body.split(/\n\s*\n/).find(p => p.trim() && !/^#/.test(p.trim())) || '').replace(/\s+/g, ' ').trim();
      const node = {
        s: d.slug, k: kind, t: d.title || d.display_en || d.slug.split('/').pop(), file: f.path,
        desc: (typeof d.description === 'string' && d.description) || para, ko: d.display_ko || null, uid: d.uid || null, p: d.path || null,
      };
      if (seen.has(node.s)) { problems.push({ file: f.path, issue: `duplicate slug ${node.s} (also ${seen.get(node.s)})` }); continue; }
      seen.set(node.s, f.path);
      nodes.push(node);
      for (const x of asList(d.domain)) rawEdges.push({ a: x, b: node.s, y: 'c', key: 'domain' });
      for (const x of asList(d.elements)) rawEdges.push({ a: node.s, b: x, y: 'c', key: 'elements' });
      for (const x of asList(d.capabilities)) rawEdges.push({ a: node.s, b: x, y: 'c', key: 'capabilities' });
      for (const x of [...asList(d.dependencies), ...asList(d.depends_on)]) rawEdges.push({ a: node.s, b: x, y: 'd', key: 'dependencies' });
      for (const x of asList(d.relates)) rawEdges.push({ a: node.s, b: x, y: 'r', key: 'relates' });
    }
    const ids = new Set(nodes.map(n => n.s)), edges = [], dangling = [], dedupe = new Set();
    for (const e of rawEdges) {
      if (!ids.has(e.a) || !ids.has(e.b)) { dangling.push(e); continue; }
      const k = `${e.a}|${e.b}|${e.y}`;
      if (dedupe.has(k) || e.a === e.b) continue;
      dedupe.add(k); edges.push({ a: e.a, b: e.b, y: e.y });
    }
    return { name, nodes, edges, dangling, problems, profiles, files: files.length };
  }

  /** Impact reach: a change reaches what depends on it and what it contains (the kernel's rule). */
  function reachAll(g) {
    const out = new Map(g.nodes.map(n => [n.s, []]));
    for (const e of g.edges) { if (e.y === 'd') out.get(e.b).push(e.a); else if (e.y === 'c') out.get(e.a).push(e.b); }
    const res = new Map();
    for (const n of g.nodes) {
      const seen = new Set([n.s]), q = [n.s];
      for (let i = 0; i < q.length; i++) for (const m of out.get(q[i])) if (!seen.has(m)) { seen.add(m); q.push(m); }
      res.set(n.s, seen.size - 1);
    }
    return res;
  }

  function sccs(nodes, next) {
    let index = 0; const idx = new Map(), low = new Map(), on = new Set(), stack = [], out = [];
    for (const start of nodes) {
      if (idx.has(start)) continue;
      const work = [[start, 0]]; idx.set(start, index); low.set(start, index++); stack.push(start); on.add(start);
      while (work.length) {
        const top = work[work.length - 1], [v, i] = top, ns = next(v);
        if (i < ns.length) {
          top[1]++; const w = ns[i];
          if (!idx.has(w)) { idx.set(w, index); low.set(w, index++); stack.push(w); on.add(w); work.push([w, 0]); }
          else if (on.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
        } else {
          work.pop();
          if (work.length) { const p = work[work.length - 1][0]; low.set(p, Math.min(low.get(p), low.get(v))); }
          if (low.get(v) === idx.get(v)) { const comp = []; let w; do { w = stack.pop(); on.delete(w); comp.push(w); } while (w !== v); out.push(comp); }
        }
      }
    }
    return out;
  }

  /** Connection tests. Each returns pass | warn | fail | info with a count and examples. */
  function testVault(g) {
    const checks = [], add = (id, label, status, value, detail, examples = []) => checks.push({ id, label, status, value, detail, examples: examples.slice(0, 5) });
    const by = new Map(g.nodes.map(n => [n.s, n]));
    const inc = new Map(g.nodes.map(n => [n.s, []]));
    for (const e of g.edges) { inc.get(e.a).push(e); inc.get(e.b).push(e); }
    add('parse', 'Every concept page parses', g.problems.length ? 'fail' : 'pass', `${g.nodes.length} concepts`, g.problems.length ? `${g.problems.length} page${g.problems.length === 1 ? '' : 's'} could not be read` : `from ${g.files} files${g.profiles.length ? ` · ${g.profiles.length} architecture profile${g.profiles.length === 1 ? '' : 's'}` : ''}`, g.problems.map(p => `${p.file}: ${p.issue}`));
    add('resolve', 'Every relation points at a concept that exists', g.dangling.length ? 'fail' : 'pass', `${g.edges.length} relations`, g.dangling.length ? `${g.dangling.length} point at nothing` : 'all resolve', g.dangling.map(e => `${e.a} → ${e.b} (${e.key})`));
    const caps = g.nodes.filter(n => n.k === 'capability'), noDom = caps.filter(c => !inc.get(c.s).some(e => e.y === 'c' && e.b === c.s && by.get(e.a).k === 'domain'));
    add('domain', 'Every capability belongs to a domain', noDom.length ? 'warn' : 'pass', `${caps.length - noDom.length}/${caps.length}`, noDom.length ? `${noDom.length} without a domain` : 'all placed', noDom.map(n => n.s));
    const els = g.nodes.filter(n => n.k === 'element'), loose = els.filter(x => !inc.get(x.s).some(e => e.y === 'c' && e.b === x.s));
    add('held', 'Every element is held by a capability or domain', loose.length ? 'warn' : 'pass', `${els.length - loose.length}/${els.length}`, loose.length ? `${loose.length} held by nothing` : 'all held', loose.map(n => n.s));
    const depNext = s => inc.get(s).filter(e => e.y === 'd' && e.a === s).map(e => e.b);
    const cycles = sccs(g.nodes.map(n => n.s), depNext).filter(c => c.length > 1);
    add('cycles', 'Dependencies form no cycle', cycles.length ? 'warn' : 'pass', `${cycles.length} cycle${cycles.length === 1 ? '' : 's'}`, cycles.length ? `largest spans ${Math.max(...cycles.map(c => c.length))} concepts` : 'the dependency graph is acyclic', cycles.map(c => c.slice(0, 4).join(' ↔ ')));
    const orphans = g.nodes.filter(n => !inc.get(n.s).length);
    add('orphans', 'No concept stands alone', orphans.length ? 'warn' : 'pass', `${orphans.length} alone`, orphans.length ? 'no relation in or out' : 'every concept has a relation', orphans.map(n => n.s));
    // weak components
    const comp = new Map(); let nComp = 0, largest = 0;
    for (const n of g.nodes) {
      if (comp.has(n.s)) continue;
      nComp++; let size = 0; const q = [n.s]; comp.set(n.s, nComp);
      while (q.length) { const x = q.pop(); size++; for (const e of inc.get(x)) { const y = e.a === x ? e.b : e.a; if (!comp.has(y)) { comp.set(y, nComp); q.push(y); } } }
      largest = Math.max(largest, size);
    }
    const share = g.nodes.length ? largest / g.nodes.length : 0;
    add('components', 'The graph holds together', nComp <= 1 ? 'pass' : share >= 0.9 ? 'warn' : 'fail', `${nComp} component${nComp === 1 ? '' : 's'}`, `the largest holds ${Math.round(share * 100)}% of concepts`);
    const r = reachAll(g), vals = [...r.values()].sort((a, b) => a - b);
    const top = [...r.entries()].sort((a, b) => b[1] - a[1])[0];
    add('reach', 'Impact reach', 'info', vals.length ? `median ${vals[vals.length >> 1]}, max ${top[1]}` : 'empty', top ? `widest: ${by.get(top[0]).t}` : '', top ? [top[0]] : []);
    const noUid = g.nodes.filter(n => !n.uid);
    add('uid', 'Every concept has a UID', noUid.length ? 'warn' : 'pass', `${g.nodes.length - noUid.length}/${g.nodes.length}`, noUid.length ? `${noUid.length} hand-made page${noUid.length === 1 ? '' : 's'}; the vault will not compile until each has one` : 'all minted', noUid.map(n => n.s));
    const ko = g.nodes.filter(n => n.ko);
    add('names', 'Localised names', 'info', `${ko.length}/${g.nodes.length}`, ko.length ? `e.g. ${ko[0].t} · ${ko[0].ko}` : 'none');
    return checks;
  }

  const summary = checks => ({ pass: checks.filter(c => c.status === 'pass').length, warn: checks.filter(c => c.status === 'warn').length, fail: checks.filter(c => c.status === 'fail').length });

  return { parseFrontmatter, parseVault, testVault, reachAll, summary };
});
