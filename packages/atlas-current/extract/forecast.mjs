// A small, causal world model over the change history: after each commit, which concepts are likely to
// change next, why, and how surprising each commit was given what came before it.
//
// The score is a weighted sum of four readable signals, each computed only from commits already seen:
//   recency     decayed count of recent changes (half-life HALF_LIFE commits)
//   co-change   how often a concept changed right after the concepts this commit touched
//   neighbours  vault or code relations to the concepts this commit touched
//   repeat      the concept changed in this very commit
// Weights and temperature are chosen on the first FIT_SHARE of commits; the rest is the hold-out that the
// reported ranking score comes from, so the page never shows a score the model was fitted on.
//
// Ranks break ties by expectation (a target tied with k others sits in the middle of them), never in the
// target's favour: sparse scorers such as recency tie most concepts at zero, and an optimistic tie rule
// would reward them for it. `auditForecast` (forecast-audit.mjs) reuses everything here.

export const HALF_LIFE = 5;
export const FIT_SHARE = 0.6;
export const TOP = 8;
export const SIGNALS = ['recency', 'cochange', 'neighbours', 'repeat'];
const GRID = {
  recency: [0, 0.5, 1, 2],
  cochange: [0, 0.5, 1, 2],
  neighbours: [0, 0.25, 0.5, 1],
  repeat: [0, 0.5, 1],
};
const TEMPS = [0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1, 1.5];

/** Expected 1-based rank of item i under random tie-breaking. `allowed` limits the candidates. */
export function expectedRank(s, i, allowed = null) {
  let greater = 0, equal = 0;
  for (let k = 0; k < s.length; k++) {
    if (allowed && !allowed.has(k)) continue;
    if (s[k] > s[i]) greater++;
    else if (s[k] === s[i]) equal++;
  }
  return 1 + greater + (equal - 1) / 2;
}

/** Probability that item i lands in the top k under random tie-breaking. */
export function topKChance(s, i, k, allowed = null) {
  let greater = 0, equal = 0;
  for (let j = 0; j < s.length; j++) {
    if (allowed && !allowed.has(j)) continue;
    if (s[j] > s[i]) greater++;
    else if (s[j] === s[i]) equal++;
  }
  if (greater >= k) return 0;
  return Math.min(1, (k - greater) / equal);
}

/** The causal signal pass. Returns everything evaluation needs; nothing here looks past commit t. */
export function prepare(timeline, vault, codeGraph, { useNeighbours = true } = {}) {
  const ids = vault.nodes.map((n) => n.s);
  const index = new Map(ids.map((s, i) => [s, i]));
  const N = ids.length;
  const seq = (timeline?.commits || [])
    .map((c) => ({ h: c.h, d: c.d, set: [...new Set([...(c.n || []), ...(c.code || [])])].map((s) => index.get(s)).filter((i) => i !== undefined) }))
    .filter((c) => c.set.length);
  const nbr = Array.from({ length: N }, () => new Set());
  if (useNeighbours) for (const e of [...vault.edges, ...(codeGraph?.edges || [])]) {
    const a = index.get(e.a), b = index.get(e.b);
    if (a !== undefined && b !== undefined && a !== b) { nbr[a].add(b); nbr[b].add(a); }
  }
  const decay = 0.5 ** (1 / HALF_LIFE);
  const rec = new Float64Array(N);
  const co = new Map(); // j -> Map(i -> count): i changed in the commit right after one that touched j
  const signals = [];
  for (let t = 0; t < seq.length; t++) {
    const cur = seq[t].set;
    if (t > 0) for (const j of seq[t - 1].set) { let row = co.get(j); if (!row) co.set(j, (row = new Map())); for (const i of cur) row.set(i, (row.get(i) || 0) + 1); }
    for (let i = 0; i < N; i++) rec[i] *= decay;
    for (const i of cur) rec[i] += 1;
    let maxRec = 0; for (let i = 0; i < N; i++) if (rec[i] > maxRec) maxRec = rec[i];
    const sig = { recency: new Float64Array(N), cochange: new Float64Array(N), neighbours: new Float64Array(N), repeat: new Float64Array(N), from: new Map() };
    for (let i = 0; i < N; i++) sig.recency[i] = rec[i] / (maxRec || 1);
    for (const j of cur) {
      const row = co.get(j);
      if (row) {
        let tot = 0; for (const v of row.values()) tot += v;
        for (const [i, v] of row) { sig.cochange[i] += v / tot / cur.length; if (!sig.from.has(i) || v > sig.from.get(i)[1]) sig.from.set(i, [j, v]); }
      }
      for (const i of nbr[j]) sig.neighbours[i] += 1 / cur.length;
      sig.repeat[j] = 1;
    }
    signals.push(sig);
  }
  return { ids, index, N, seq, signals };
}

export function score(prep, t, w) {
  const sig = prep.signals[t], s = new Float64Array(prep.N);
  for (let i = 0; i < prep.N; i++) s[i] = w.recency * sig.recency[i] + w.cochange * sig.cochange[i] + w.neighbours * sig.neighbours[i] + w.repeat * sig.repeat[i];
  return s;
}

/** Mean over steps of the mean reciprocal expected rank of what changed next. */
export function meanMrr(prep, steps, w, allowedAt = null) {
  let total = 0, n = 0;
  for (const t of steps) {
    const allowed = allowedAt ? allowedAt(t + 1) : null;
    const truth = prep.seq[t + 1].set.filter((i) => !allowed || allowed.has(i));
    if (!truth.length) continue;
    const s = score(prep, t, w);
    total += truth.reduce((a, i) => a + 1 / expectedRank(s, i, allowed), 0) / truth.length; n++;
  }
  return n ? total / n : null;
}

export function meanRecall(prep, steps, w, k) {
  let total = 0, n = 0;
  for (const t of steps) {
    const truth = prep.seq[t + 1].set, s = score(prep, t, w);
    total += truth.reduce((a, i) => a + topKChance(s, i, k), 0) / truth.length; n++;
  }
  return n ? total / n : null;
}

export function splitSteps(prep, fitShare = FIT_SHARE) {
  const fitEnd = Math.max(2, Math.floor((prep.seq.length - 1) * fitShare));
  const fit = [], held = [];
  for (let t = 0; t < prep.seq.length - 1; t++) (t < fitEnd ? fit : held).push(t);
  return { fitEnd, fit, held };
}

/** Grid search on the fit steps only. `zero` pins signals to 0 (for ablations). */
export function fitWeights(prep, fitSteps, { zero = [] } = {}) {
  let best = null;
  for (const recency of GRID.recency) for (const cochange of GRID.cochange) for (const neighbours of GRID.neighbours) for (const repeat of GRID.repeat) {
    const w = { recency, cochange, neighbours, repeat };
    if (zero.some((k) => w[k] !== 0)) continue;
    if (recency + cochange + neighbours + repeat === 0) continue;
    const m = meanMrr(prep, fitSteps, w);
    if (!best || m > best.mrr + 1e-12) best = { w, mrr: m };
  }
  return best;
}

export const BASELINES = {
  recency: { recency: 1, cochange: 0, neighbours: 0, repeat: 0 },
  cochange: { recency: 0, cochange: 1, neighbours: 0, repeat: 0 },
  neighbours: { recency: 0, cochange: 0, neighbours: 1, repeat: 0 },
};

const probs = (s, temp) => { let mx = -Infinity; for (const v of s) if (v > mx) mx = v; const e = Array.from(s, (v) => Math.exp((v - mx) / temp)); const z = e.reduce((a, b) => a + b, 0); return e.map((v) => v / z); };

/** @returns {{ model: object | null, steps: object[], next: object | null }} */
export function forecastChanges(timeline, vault, codeGraph) {
  const prep = prepare(timeline, vault, codeGraph);
  const { ids, N, seq } = prep;
  if (N === 0 || seq.length < 4) return { model: null, steps: [], next: null };
  const { fitEnd, fit, held } = splitSteps(prep);
  const best = fitWeights(prep, fit);

  let temp = TEMPS[0], bestLL = -Infinity;
  for (const T of TEMPS) {
    let ll = 0;
    for (const t of fit) { const p = probs(score(prep, t, best.w), T); for (const i of seq[t + 1].set) ll += Math.log(p[i] + 1e-12); }
    if (ll > bestLL) { bestLL = ll; temp = T; }
  }
  const uniformBits = Math.log2(N);

  const why = (t, i) => {
    const sig = prep.signals[t];
    const c = best.w.cochange * sig.cochange[i], r = best.w.recency * sig.recency[i], n = best.w.neighbours * sig.neighbours[i], p = best.w.repeat * sig.repeat[i];
    const top = Math.max(c, r, n, p);
    if (c && c === top && sig.from.has(i)) return { kind: 'cochange', with: ids[sig.from.get(i)[0]], count: sig.from.get(i)[1] };
    if (n && n === top) return { kind: 'neighbour' };
    if (p && p === top) return { kind: 'repeat' };
    return { kind: 'recent' };
  };
  const forecastAt = (t) => {
    const p = probs(score(prep, t, best.w), temp);
    return [...p.keys()].sort((a, b) => p[b] - p[a]).slice(0, TOP).map((i) => ({ s: ids[i], p: +p[i].toFixed(4), why: why(t, i) }));
  };

  const steps = seq.map((c, t) => {
    let surprise = null, hit = null;
    if (t > 0) {
      const s = score(prep, t - 1, best.w), p = probs(s, temp);
      const bits = c.set.reduce((a, i) => a - Math.log2(p[i] + 1e-12), 0) / c.set.length;
      surprise = +(bits / uniformBits).toFixed(3); // 1 = as surprising as a uniform guess
      hit = +(c.set.reduce((a, i) => a + topKChance(s, i, TOP), 0) / c.set.length).toFixed(3);
    }
    const actualNext = t + 1 < seq.length ? seq[t + 1].set.map((i) => ids[i]) : null;
    return { h: c.h, d: c.d, surprise, hit, heldOut: t >= fitEnd, forecast: forecastAt(t), actualNext };
  });

  return {
    model: {
      signals: SIGNALS,
      weights: best.w,
      temperature: temp,
      halfLife: HALF_LIFE,
      fittedOn: fit.length,
      heldOut: held.length,
      ties: 'expected rank',
      mrr: meanMrr(prep, held, best.w),
      recallAt8: meanRecall(prep, held, best.w, TOP),
      baselines: Object.fromEntries(Object.entries(BASELINES).map(([k, w]) => [k, meanMrr(prep, held, w)])),
      concepts: N,
      commits: seq.length,
    },
    steps,
    next: steps.length ? { after: steps.at(-1).h, forecast: steps.at(-1).forecast } : null,
  };
}
