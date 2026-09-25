// Checks the forecast before anyone trusts it: is the score real, or an artefact of how it was measured,
// labelled or ordered? Each check reruns the same model with one assumption removed and reports the
// difference, so a reader can see which part of the headline survives.
//
//   ties            optimistic vs expected tie rule, including what a search fitted under the optimistic rule
//                   would claim (it prefers sparse scores that tie most concepts at zero)
//   random          the score of a random ranking, the floor every other number is read against
//   calibration     Brier skill against always predicting the base rate; with ~1-2% positives, accuracy
//                   and ECE look excellent for a model that predicts nothing, so neither is reported alone
//   labels          concepts are labelled with today's vault: score only concepts whose page existed then
//   graph           the neighbour signal reads today's relations: refit without it
//   repeats         how much of the score is "it changed again": score only targets that did not change in
//                   the previous REPEAT_WINDOW commits
//   order           commits from parallel branches interleave by date; count date inversions in the sequence
//   stability       the same comparison at several fit/hold-out splits (rolling origin)
//   interval        paired bootstrap of model minus recency on the hold-out
import {
  BASELINES, FIT_SHARE, expectedRank, fitWeights, meanMrr, prepare, score, splitSteps,
} from './forecast.mjs';

const REPEAT_WINDOW = 5;
const SPLITS = [0.4, 0.5, 0.6, 0.7];
const RESAMPLES = 2000;

function rng(seed) { let x = seed >>> 0 || 1; return () => ((x = (x * 1664525 + 1013904223) >>> 0) / 4294967296); }

function perStepMrr(prep, steps, w, allowedAt = null, keep = null) {
  const out = [];
  for (const t of steps) {
    const allowed = allowedAt ? allowedAt(t + 1) : null;
    const truth = prep.seq[t + 1].set.filter((i) => (!allowed || allowed.has(i)) && (!keep || keep(t, i)));
    if (!truth.length) { out.push(null); continue; }
    const s = score(prep, t, w);
    out.push(truth.reduce((a, i) => a + 1 / expectedRank(s, i, allowed), 0) / truth.length);
  }
  return out;
}
const mean = (xs) => { const v = xs.filter((x) => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };

function optimisticMrr(prep, steps, w) {
  return mean(steps.map((t) => {
    const s = score(prep, t, w), truth = prep.seq[t + 1].set;
    return truth.reduce((a, i) => { let r = 1; for (let k = 0; k < s.length; k++) if (s[k] > s[i]) r++; return a + 1 / r; }, 0) / truth.length;
  }));
}

export function auditForecast(timeline, vault, codeGraph) {
  const prep = prepare(timeline, vault, codeGraph);
  if (prep.N === 0 || prep.seq.length < 8) return { ok: false, reason: 'not enough history to audit' };
  const { fit, held } = splitSteps(prep);
  const best = fitWeights(prep, fit);
  const rec = BASELINES.recency;
  const flags = [];
  const r3 = (x) => (x == null ? null : +x.toFixed(3));

  // ties
  const ties = {
    model: { expected: r3(meanMrr(prep, held, best.w)), optimistic: r3(optimisticMrr(prep, held, best.w)) },
    recency: { expected: r3(meanMrr(prep, held, rec)), optimistic: r3(optimisticMrr(prep, held, rec)) },
  };

  // the same search, fitted and scored under the optimistic rule: the number an optimistic harness reports
  let optBest = null;
  for (const recency of [0, 0.5, 1, 2]) for (const cochange of [0, 0.5, 1, 2]) for (const neighbours of [0, 0.25, 0.5, 1]) for (const repeat of [0, 0.5, 1]) {
    const w = { recency, cochange, neighbours, repeat };
    if (recency + cochange + neighbours + repeat === 0) continue;
    const m = optimisticMrr(prep, fit, w);
    if (!optBest || m > optBest.m) optBest = { w, m };
  }
  ties.optimisticSearch = { weights: optBest.w, heldOut: r3(optimisticMrr(prep, held, optBest.w)) };
  if (ties.optimisticSearch.heldOut - ties.model.expected > 0.05) flags.push(`an optimistic tie rule would report ${ties.optimisticSearch.heldOut} instead of ${ties.model.expected}`);
  let harmonic = 0; for (let k = 1; k <= prep.N; k++) harmonic += 1 / k;
  const random = r3(harmonic / prep.N);

  // calibration against the base rate
  const probsOf = (s) => { let mx = -Infinity; for (const v of s) if (v > mx) mx = v; const e = Array.from(s, (v) => Math.exp((v - mx) / 0.35)); const z = e.reduce((a, b) => a + b, 0); return e.map((v) => v / z); };
  let bModel = 0, bBase = 0, n = 0, positives = 0;
  const trainRate = mean(fit.map((t) => prep.seq[t + 1].set.length / prep.N));
  for (const t of held) {
    const p = probsOf(score(prep, t, best.w)), truth = new Set(prep.seq[t + 1].set);
    // scale the distribution over concepts to per-concept probabilities with the expected set size
    const size = prep.seq[t].set.length;
    for (let i = 0; i < prep.N; i++) { const y = truth.has(i) ? 1 : 0, q = Math.min(1, p[i] * size); bModel += (q - y) ** 2; bBase += (trainRate - y) ** 2; n++; positives += y; }
  }
  const calibration = { baseRate: r3(positives / n), brierModel: +(bModel / n).toFixed(5), brierBaseRate: +(bBase / n).toFixed(5), brierSkill: r3(1 - bModel / bBase) };
  if (calibration.brierSkill <= 0) flags.push('probabilities are no better than the base rate; show ranks, not percentages');

  // labels: only concepts whose page existed at the time
  const born = new Map();
  for (const c of vault.commits || []) for (const s of c.n || []) if (!born.has(s)) born.set(s, +new Date(c.d));
  const existedAt = (t) => { const when = +new Date(prep.seq[t].d), ok = new Set(); prep.ids.forEach((s, i) => { if (!born.has(s) || born.get(s) <= when) ok.add(i); }); return ok; };
  let future = 0, targets = 0;
  for (const t of held) { const ok = existedAt(t + 1); for (const i of prep.seq[t + 1].set) { targets++; if (!ok.has(i)) future++; } }
  const labels = {
    targetsBeforeTheirPage: r3(future / Math.max(1, targets)),
    model: r3(meanMrr(prep, held, best.w, existedAt)),
    recency: r3(meanMrr(prep, held, rec, existedAt)),
  };
  if (labels.targetsBeforeTheirPage > 0.1) flags.push(`${Math.round(labels.targetsBeforeTheirPage * 100)}% of hold-out targets changed before their concept page existed; today's labels reach into the past`);

  // graph: refit without today's relations
  const prepNoGraph = prepare(timeline, vault, codeGraph, { useNeighbours: false });
  const bestNoGraph = fitWeights(prepNoGraph, fit, { zero: ['neighbours'] });
  const graph = { withRelations: ties.model.expected, withoutRelations: r3(meanMrr(prepNoGraph, held, bestNoGraph.w)), weightsWithout: bestNoGraph.w };
  if (graph.withRelations - graph.withoutRelations > 0.03) flags.push('part of the score comes from today\'s relations, which did not all exist at the time');

  // repeats: score only targets that were quiet for the previous REPEAT_WINDOW commits
  const quiet = (t, i) => { for (let k = Math.max(0, t - REPEAT_WINDOW + 1); k <= t; k++) if (prep.seq[k].set.includes(i)) return false; return true; };
  let repeatTargets = 0, allTargets = 0;
  for (const t of held) for (const i of prep.seq[t + 1].set) { allTargets++; if (!quiet(t, i)) repeatTargets++; }
  const repeats = {
    shareOfTargetsSeenInLastWindow: r3(repeatTargets / Math.max(1, allTargets)),
    window: REPEAT_WINDOW,
    novelModel: r3(mean(perStepMrr(prep, held, best.w, null, quiet))),
    novelRecency: r3(mean(perStepMrr(prep, held, rec, null, quiet))),
    novelCochange: r3(mean(perStepMrr(prep, held, BASELINES.cochange, null, quiet))),
  };
  if (repeats.shareOfTargetsSeenInLastWindow > 0.5) flags.push(`${Math.round(repeats.shareOfTargetsSeenInLastWindow * 100)}% of targets repeat a concept from the last ${REPEAT_WINDOW} commits; the headline mostly measures persistence`);

  // order
  let inversions = 0;
  for (let t = 1; t < prep.seq.length; t++) if (+new Date(prep.seq[t].d) < +new Date(prep.seq[t - 1].d)) inversions++;
  const order = { dateInversions: inversions, share: r3(inversions / (prep.seq.length - 1)) };
  if (order.share > 0.05) flags.push('commits are not in time order (parallel branches); "next" is partly an artefact of the log order');

  // stability across splits
  const stability = SPLITS.map((share) => {
    const sp = splitSteps(prep, share), b = fitWeights(prep, sp.fit);
    return { fitShare: share, heldOut: sp.held.length, model: r3(meanMrr(prep, sp.held, b.w)), recency: r3(meanMrr(prep, sp.held, rec)) };
  });
  if (stability.some((s) => s.model != null && s.recency != null && s.model <= s.recency)) flags.push('at some split the model does not beat recency');

  // paired bootstrap, model minus recency
  const a = perStepMrr(prep, held, best.w), b = perStepMrr(prep, held, rec);
  const diffs = a.map((x, i) => (x == null || b[i] == null ? null : x - b[i])).filter((x) => x != null);
  const r = rng(7), boots = [];
  for (let k = 0; k < RESAMPLES; k++) { let s = 0; for (let j = 0; j < diffs.length; j++) s += diffs[Math.floor(r() * diffs.length)]; boots.push(s / diffs.length); }
  boots.sort((x, y) => x - y);
  const interval = { meanDiff: r3(mean(diffs)), lo: r3(boots[Math.floor(0.025 * RESAMPLES)]), hi: r3(boots[Math.floor(0.975 * RESAMPLES)]), steps: diffs.length };
  if (interval.lo <= 0) flags.push('the 95% interval of model minus recency includes zero');

  if (repeats.novelModel != null && repeats.novelModel < random * 1.5) flags.push(`on work that did not just happen, ranking is near random (${repeats.novelModel} vs ${random})`);
  return { ok: true, fitShare: FIT_SHARE, weights: best.w, random, ties, calibration, labels, graph, repeats, order, stability, interval, flags };
}
