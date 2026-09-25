// Run every extractor against one repository and return the data the app reads.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { extractVault } from '../extract/vault.mjs';
import { extractCode } from '../extract/code.mjs';
import { extractTimeline } from '../extract/timeline.mjs';
import { extractSemantic } from '../extract/semantic.mjs';
import { extractTrace } from '../extract/trace.mjs';
import { forecastChanges } from '../extract/forecast.mjs';
import { auditForecast } from '../extract/forecast-audit.mjs';

const VAULT_CANDIDATES = ['atlas', 'docs/ontology'];
const KIND_DIRS = ['domains', 'capabilities', 'elements'];

export function findVault(repo, explicit) {
  if (explicit) {
    if (!fs.existsSync(path.join(repo, explicit))) throw new Error(`vault ${explicit} does not exist in ${repo}`);
    return explicit;
  }
  const hit = VAULT_CANDIDATES.find((v) => KIND_DIRS.some((d) => fs.existsSync(path.join(repo, v, d))));
  if (!hit) throw new Error(`no vault found in ${repo}; looked in ${VAULT_CANDIDATES.join(', ')} (pass --vault)`);
  return hit;
}

export function makeContext({ repo, vault, ref = 'HEAD' }) {
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', maxBuffer: 1 << 30 });
  git('rev-parse', '--verify', `${ref}^{commit}`);
  // Every file's commits, newest first, from one pass over the history instead of one `git log` per file.
  // `pos` is the commit's place in that walk (0 = newest), so "after" comparisons need no more Git calls.
  let byFile = null;
  const countOf = new Map();
  const history = (file) => {
    if (!byFile) {
      byFile = new Map();
      const raw = git('log', ref, '--no-renames', '--format=%x1e%H%x1f%h%x1f%aI%x1f%s', '--name-only');
      let pos = 0;
      for (const block of raw.split('\x1e')) {
        if (!block.trim()) continue;
        const [head, ...files] = block.split('\n');
        const [H, h, iso, s] = head.split('\x1f');
        const commit = { H, h, iso, d: iso.slice(0, 10), s, pos: pos++ };
        countOf.set(h, files.filter((f) => f.trim()).length);
        for (const f of files) {
          const k = f.trim(); if (!k) continue;
          let list = byFile.get(k); if (!list) byFile.set(k, (list = []));
          list.push(commit);
        }
      }
    }
    return byFile.get(file) || [];
  };
  const filesIn = (h) => { history(''); return countOf.get(h) || 0; };
  return { repo, vault, ref, git, history, filesIn };
}

function vaultSource(repo, vault, label) {
  const files = [];
  for (const dir of [...KIND_DIRS, 'architecture']) {
    const abs = path.join(repo, vault, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.md')).sort()) {
      const t = fs.readFileSync(path.join(abs, f), 'utf8');
      const end = t.indexOf('\n---', 4);
      files.push({ path: `${dir}/${f}`, text: end > 0 ? t.slice(0, end + 4) + t.slice(end + 4, end + 4 + 900) : t.slice(0, 1500) });
    }
  }
  return { label, note: `${vault} in this repository`, files };
}

export async function buildData({ repo, vault: vaultArg, ref = 'HEAD', codeGraph = null, services = null, log = () => {} }) {
  const vault = findVault(repo, vaultArg);
  const ctx = makeContext({ repo, vault, ref });
  const name = path.basename(repo);
  const v = extractVault(ctx);
  log(`vault ${vault}: ${v.nodes.length} concepts, ${v.edges.length} relations, ${v.commits.length} page commits`);
  const code = extractCode(ctx, v);
  const cgr = codeGraph ? JSON.parse(fs.readFileSync(codeGraph, 'utf8')) : null;
  const timeline = extractTimeline(ctx, v, code, cgr);
  log(`history: ${timeline.commits.length} commits touched a concept's page or code`);
  const semantic = extractSemantic(v, code, cgr);
  let trace = { nodes: [], edges: [], source: null };
  if (fs.existsSync(path.join(repo, 'scripts/lib/po-risk-router.mjs')) && fs.existsSync(path.join(repo, 'app'))) {
    try { trace = await extractTrace(ctx, v); } catch (e) { log(`trace skipped: ${e.message.split('\n')[0]}`); }
  }
  const forecast = forecastChanges(timeline, v, cgr);
  if (forecast.model) forecast.audit = auditForecast(timeline, v, cgr);
  if (forecast.model) {
    const m = forecast.model, f = (x) => (x == null ? 'n/a' : x.toFixed(3));
    log(`forecast: hold-out MRR ${f(m.mrr)} (recency ${f(m.baselines.recency)}, co-change ${f(m.baselines.cochange)}) over ${m.heldOut} commits`);
    for (const flag of forecast.audit?.flags || []) log(`forecast audit: ${flag}`);
  }
  const head = ctx.git('rev-parse', '--short', ref).trim();
  return {
    vault: v, code, codeGraph: cgr, timeline, semantic, trace, forecast,
    // the app treats the key `atlas` as the repository's own vault (Studio links back into the map)
    sources: { atlas: vaultSource(repo, vault, name) },
    meta: { repo: name, vault, ref, head, builtAt: new Date().toISOString(), generator: 'atlas-current', services: services ? JSON.parse(fs.readFileSync(services, 'utf8')) : [] },
  };
}
