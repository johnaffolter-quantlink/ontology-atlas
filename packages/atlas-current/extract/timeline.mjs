// Two lanes of real history over the same window: commits that changed a concept's page (meaning)
// and commits that changed a concept's implementation file (code). `files` counts every file the commit
// changed; `add`/`del` count lines in the concepts' own pages and implementation files, which is what
// keeps this to one cheap diff over a few hundred paths instead of every file in the repository.

export function extractTimeline(ctx, D, CODE, CGR) {
if (!D.commits.length) return { since: null, commits: [] };
const pageOf = new Map(), codeOf = new Map();
for (const n of D.nodes) if (n.file) pageOf.set(n.file.replace(/^\/+/, ''), n.s);
for (const [s, c] of Object.entries(CODE)) { codeOf.set(c.path, s); codeOf.set(c.file, s); }
const since = D.commits[0].d;
const paths = [...new Set([...pageOf.keys(), ...codeOf.keys()])].filter(Boolean);
const raw = paths.length ? ctx.git('log', ctx.ref, '--no-merges', '--no-renames', `--since=${since}`, '--format=%x1e%h%x1f%aI%x1f%s', '--numstat', '--', ...paths) : '';
// who calls into a concept, by code: the concepts a change there can break
const callers = new Map();
for (const e of CGR?.edges || []) { if (!callers.has(e.b)) callers.set(e.b, new Set()); callers.get(e.b).add(e.a); }
const out = [];
for (const block of raw.split('\x1e').filter(b => b.trim())) {
  const [head, ...rest] = block.split('\n');
  const [h, d, s] = head.split('\x1f');
  let add = 0, del = 0, files = 0;
  const pages = new Set(), code = new Set();
  for (const line of rest) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/); if (!m) continue;
    add += +m[1] || 0; del += +m[2] || 0;
    const f = m[3].replace(/^.*\{.* => (.*)\}.*$/, '$1');
    if (pageOf.has(f)) pages.add(pageOf.get(f));
    if (codeOf.has(f)) code.add(codeOf.get(f));
  }
  if (!pages.size && !code.size) continue;
  files = ctx.filesIn ? ctx.filesIn(h) : 0;
  const reach = new Set();
  for (const c of code) for (const r of callers.get(c) || []) if (!code.has(r)) reach.add(r);
  out.push({ h, d, s: s.slice(0, 140), n: [...pages], code: [...code], reach: [...reach].slice(0, 24), files, add, del });
}
out.reverse();
return { since, commits: out };
}
