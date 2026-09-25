// Real source for every concept: the implementation file's own lines (the first exported
// declaration and its doc comment), its exports, its recent commits, and the tests that import it.
import fs from 'node:fs';
import path from 'node:path';

export function extractCode(ctx, D) {
const ROOT = ctx.repo, git = ctx.git;
const tests = git('ls-files', '*.test.ts', '*.test.tsx', '*.test.mjs', '*.spec.ts').split('\n').filter(Boolean)
  .map(f => ({ f, text: fs.readFileSync(path.join(ROOT, f), 'utf8') }));
const EXPORT = /^\s*export\s+(?:default\s+)?(?:async\s+)?(function\*?|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const out = {};
for (const n of D.nodes) {
  if (!n.p) continue;
  const abs = path.join(ROOT, n.p);
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) continue;
  let file = n.p, lines = fs.readFileSync(abs, 'utf8').split('\n');
  // a barrel only re-exports: follow it to the file that holds the code
  for (let hop = 0; hop < 3 && lines.filter(l => l.trim()).every(l => /^\s*(export\s+(\*|\{[^}]*\}|type\s+\{[^}]*\})\s+from|\/\/|\/\*|\*)/.test(l)); hop++) {
    const m = lines.join('\n').match(/from\s+['"](\.[^'"]+)['"]/); if (!m) break;
    const baseDir = path.dirname(path.join(ROOT, file)), cand = ['', '.ts', '.tsx', '.mjs', '/index.ts', '/index.tsx'].map(x => path.join(baseDir, m[1] + x)).find(x => fs.existsSync(x) && fs.statSync(x).isFile());
    if (!cand) break;
    file = path.relative(ROOT, cand); lines = fs.readFileSync(cand, 'utf8').split('\n');
  }
  const exports = [];
  lines.forEach((l, i) => { const m = l.match(EXPORT); if (m) exports.push({ name: m[2], kind: m[1], line: i + 1 }); });
  // the excerpt, as segments with real line numbers: the doc comment that opens the file (or the
  // first export), then the first declaration with a body
  const clip = (a, b) => lines.slice(a, b).map(l => l.replace(/\t/g, '  ').slice(0, 110));
  const isNote = l => /^\s*(\*|\/\*\*?|\/\/|\*\/)/.test(l) || !l.trim();
  const first = exports.find(e => /function|class|const/.test(e.kind)) || exports[0];
  let at = first ? first.line - 1 : lines.findIndex(l => /^\s*(export\s+)?(async\s+)?(function|class|const|let)\s/.test(l));
  if (at < 0) at = 0;
  let docStart = at; while (docStart > 0 && isNote(lines[docStart - 1])) docStart--;
  const segments = [];
  let headEnd = 0; while (headEnd < lines.length && isNote(lines[headEnd]) && headEnd < 60) headEnd++;
  if (headEnd > 2 && headEnd <= docStart) segments.push({ start: 1, lines: clip(0, Math.min(headEnd, 9)) });
  const codeFrom = Math.max(docStart, at - 6);
  segments.push({ start: codeFrom + 1, lines: clip(codeFrom, codeFrom + (segments.length ? 22 : 28)) });
  for (const sg of segments) while (sg.lines.length && !sg.lines[sg.lines.length - 1].trim()) sg.lines.pop();
  const commits = ctx.history(n.p).slice(0, 4).map(c => ({ h: c.h, d: c.d, s: c.s.slice(0, 120) }));
  const stem = n.p.replace(/\.(tsx?|mjs|js)$/, '').replace(/\/index$/, '');
  const alias = stem.startsWith('src/') ? '@/' + stem.slice(4) : null;
  const base = path.basename(stem) === 'index' ? path.basename(path.dirname(stem)) : path.basename(stem);
  const t = tests.filter(x => (alias && x.text.includes(`'${alias}`)) || (base.length > 3 && (x.text.includes(`/${base}'`) || x.text.includes(`/${base}.`)))).map(x => x.f).slice(0, 4);
  out[n.s] = { path: n.p, file, lines: lines.length, exports: exports.slice(0, 12), segments, commits, tests: t };
}
return out;
}
