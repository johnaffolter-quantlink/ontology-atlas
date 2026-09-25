// A meaning index over every concept: its page (title, summary, body) and its code (the function
// and export names code-graph-rag parsed, split into words). TF-IDF with sublinear term frequency;
// cosine similarity gives each concept its nearest neighbours, and the close pairs that neither the
// vault nor the code connects become suggested relations.
export function extractSemantic(D, CODE, CGR) {
CGR = CGR || { concepts: {}, edges: [] };
const STOP = new Set(('a an and are as at be by can for from has have in into is it its of on or that the this to was were will with not no one each any all it\'s which what when where who why how than then so such do does done also only own same other more most but like looks long input output row opt yes kept keeps still just if else they them their there these those we you your our via per may might must should would could get set use used uses using make makes new true false null undefined const let var function return export import default async await type interface string number boolean void page pages concept concepts').split(' '));
const split = s => String(s || '')
  .replace(/`[^`]*`/g, m => m.slice(1, -1))
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-/.:]/g, ' ')
  .toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [];
const stem = w => w.length > 5 ? w.replace(/(ings|ing|ions|ion|ers|er|ies|es|s|ed|ly)$/, '') : w;
const surface = new Map(); // stem -> the word it most often came from, for display
const docs = D.nodes.map(n => {
  const g = CGR.concepts[n.s], c = CODE[n.s];
  const text = [n.t, n.t, n.t, n.desc, n.body,
    ...(g?.defines || []).map(d => `${d.name} ${d.name} ${d.doc}`),
    ...(c?.exports || []).map(e => e.name), n.p].join(' ');
  const tf = new Map();
  for (const w of split(text)) { if (STOP.has(w)) continue; const t = stem(w); tf.set(t, (tf.get(t) || 0) + 1); const m = surface.get(t) || new Map(); m.set(w, (m.get(w) || 0) + 1); surface.set(t, m); }
  return { s: n.s, tf };
});
const df = new Map();
for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
const N = docs.length, idf = new Map([...df].map(([t, k]) => [t, Math.log((N + 1) / (k + 0.5))]));
for (const d of docs) {
  const v = new Map(); let norm = 0;
  for (const [t, k] of d.tf) { if (df.get(t) < 2 && k < 2) continue; const w = (1 + Math.log(k)) * idf.get(t); v.set(t, w); norm += w * w; }
  norm = Math.sqrt(norm) || 1;
  for (const [t, w] of v) v.set(t, w / norm);
  d.v = v;
}
const word = t => [...(surface.get(t) || new Map([[t, 1]]))].sort((x, y) => y[1] - x[1])[0][0];
const cos = (a, b) => { let s = 0; const [x, y] = a.size < b.size ? [a, b] : [b, a]; for (const [t, w] of x) { const u = y.get(t); if (u) s += w * u; } return s; };
const linked = new Set();
for (const e of D.edges) { linked.add(`${e.a}|${e.b}`); linked.add(`${e.b}|${e.a}`); }
const codeLinked = new Set();
for (const e of CGR.edges) { codeLinked.add(`${e.a}|${e.b}`); codeLinked.add(`${e.b}|${e.a}`); }
const out = { concepts: {}, suggestions: [], idf: {}, source: { docs: N, terms: 0 } };
const pairs = [];
for (let i = 0; i < N; i++) {
  const a = docs[i], near = [];
  for (let j = 0; j < N; j++) if (i !== j) near.push([docs[j].s, cos(a.v, docs[j].v)]);
  near.sort((x, y) => y[1] - x[1]);
  const shared = (b) => [...a.v].filter(([t]) => b.v.has(t)).map(([t, w]) => [t, w * b.v.get(t)]).sort((x, y) => y[1] - x[1]).slice(0, 4).map(x => word(x[0]));
  out.concepts[a.s] = {
    terms: [...a.v].sort((x, y) => y[1] - x[1]).slice(0, 8).map(x => word(x[0])),
    near: near.slice(0, 6).map(([s, sc]) => ({ s, score: +sc.toFixed(3), linked: linked.has(`${a.s}|${s}`), code: codeLinked.has(`${a.s}|${s}`), shared: shared(docs.find(d => d.s === s)) })),
    // the page's weights for client-side search: the strongest 60 terms
    w: Object.fromEntries([...a.v].sort((x, y) => y[1] - x[1]).slice(0, 60).map(([t, w]) => [t, +w.toFixed(4)])),
  };
  for (const [s, sc] of near.slice(0, 8)) if (a.s < s && !linked.has(`${a.s}|${s}`)) pairs.push({ a: a.s, b: s, score: +sc.toFixed(3), code: codeLinked.has(`${a.s}|${s}`), shared: shared(docs.find(d => d.s === s)) });
}
const seen = new Set();
out.suggestions = pairs.sort((x, y) => (y.code - x.code) || (y.score - x.score)).filter(p => { const k = `${p.a}|${p.b}`; if (seen.has(k)) return false; seen.add(k); return p.score >= 0.18 || p.code; }).slice(0, 40);
const used = new Set(Object.values(out.concepts).flatMap(c => Object.keys(c.w)));
for (const t of used) out.idf[t] = +idf.get(t).toFixed(3);
out.source.terms = used.size;
return out;
}
