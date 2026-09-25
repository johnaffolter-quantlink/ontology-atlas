// End to end on a throwaway Git repository: the storefront sample as ./atlas, a scripted history of page
// and code changes, then extract, forecast, audit, assemble and serve. No network.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildData, findVault } from '../lib/build-data.mjs';
import { assemble } from '../lib/assemble.mjs';
import { expectedRank, topKChance } from '../extract/forecast.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const BIN = path.join(HERE, '..', 'bin', 'atlas-current.mjs');
let repo;

function git(...a) {
  return execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
}
let clock = Date.parse('2026-01-01T00:00:00Z');
function commit(message) {
  clock += 3_600_000;
  const when = new Date(clock).toISOString();
  git('add', '-A');
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', message], { env: { ...process.env, GIT_AUTHOR_NAME: 'fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when } });
}
const touch = (rel, line) => fs.appendFileSync(path.join(repo, rel), `\n${line}\n`);

before(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-current-'));
  git('init', '-q', '-b', 'main');
  fs.cpSync(path.join(ROOT, 'samples', 'storefront'), path.join(repo, 'atlas'), { recursive: true });
  // give one capability an implementation file, so the code lane has something to follow
  const cart = path.join(repo, 'atlas', 'capabilities', 'cart.md');
  fs.writeFileSync(cart, fs.readFileSync(cart, 'utf8').replace(/^---\n/, '---\npath: src/cart.ts\n'));
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'cart.ts'), 'export function addToCart() {}\n');
  // page text that would end an inline <script> if the build did not escape it
  touch('atlas/capabilities/faq.md', 'Hostile example: </script><script>window.__pwned = 1</script>');
  commit('feat: start the storefront vault');
  const pages = ['cart', 'checkout', 'cart', 'coupon-issue', 'cart', 'checkout', 'faq', 'cart', 'checkout', 'cart', 'flash-sale', 'cart'];
  pages.forEach((p, i) => {
    touch(`atlas/capabilities/${p}.md`, `Revision ${i}.`);
    if (i % 3 === 0) touch('src/cart.ts', `// change ${i}`);
    commit(`${i % 2 ? 'fix' : 'feat'}: revise ${p} (${i})`);
  });
  touch('src/cart.ts', '// code only'); commit('refactor: cart internals');
});
after(() => fs.rmSync(repo, { recursive: true, force: true }));

test('finds ./atlas and refuses a folder without a vault', () => {
  assert.equal(findVault(repo), 'atlas');
  assert.throws(() => findVault(os.tmpdir()), /no vault found/);
});

test('extracts concepts, page history and the code lane from Git', async () => {
  const data = await buildData({ repo, ref: 'HEAD' });
  const files = ['domains', 'capabilities', 'elements'].flatMap((d) => fs.readdirSync(path.join(repo, 'atlas', d)));
  assert.equal(data.vault.nodes.length, files.length);
  const cart = data.vault.nodes.find((n) => n.s === 'capabilities/cart');
  assert.equal(cart.revs, 7, 'cart page: first commit plus six revisions');
  assert.equal(cart.last.h, git('log', '-1', '--format=%h', '--', 'atlas/capabilities/cart.md').trim());
  assert.ok(cart.align?.exists);
  assert.equal(cart.align.after, 1, 'one code commit after the last page change');
  const codeOnly = data.timeline.commits.filter((c) => c.code.includes('capabilities/cart') && !c.n.length);
  assert.ok(codeOnly.length >= 1, 'a code-only commit reaches the cart concept');
  assert.ok(data.timeline.commits.every((c) => c.files >= 1));
});

test('forecast is causal, ranks by expectation and carries its audit', async () => {
  const data = await buildData({ repo, ref: 'HEAD' });
  const f = data.forecast;
  assert.ok(f.model, 'enough history for a model');
  assert.equal(f.model.ties, 'expected rank');
  assert.equal(f.steps.length, data.timeline.commits.length);
  assert.ok(f.steps.every((s, i) => i === 0 ? s.surprise === null : s.surprise >= 0));
  assert.deepEqual(f.steps.at(-1).actualNext, null, 'nothing after the last commit');
  assert.ok(f.audit.ok);
  for (const k of ['ties', 'calibration', 'labels', 'graph', 'repeats', 'order', 'stability', 'interval', 'random', 'flags']) assert.ok(k in f.audit, k);
  assert.ok(f.audit.random > 0 && f.audit.random < 1);
});

test('tie rule: a target tied with others is not ranked first', () => {
  const s = Float64Array.from([0, 0, 0, 0, 1]);
  assert.equal(expectedRank(s, 4), 1);
  assert.equal(expectedRank(s, 0), 3.5, 'four tied behind one leader: expected rank 1 + 0 + 3/2 + 1');
  assert.equal(topKChance(s, 0, 1), 0);
  assert.equal(topKChance(s, 0, 3), 0.5);
  assert.equal(topKChance(s, 4, 1), 1);
});

test('assembles a self-contained page and a local one', async () => {
  const data = await buildData({ repo, ref: 'HEAD' });
  const cdnDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-current-cdn-'));
  const { index } = assemble(data, { out: cdnDir, mode: 'cdn' });
  const html = fs.readFileSync(index, 'utf8');
  assert.doesNotMatch(html, /__(DATA|CODE|CGR|TIMELINE|SEMANTIC|TRACE|SOURCES|SOURCESJS)__/);
  assert.match(html, /id="atlas-forecast"/);
  const json = html.match(/<script type="application\/json" id="atlas-data">([\s\S]*?)<\/script>/)[1];
  const embedded = JSON.parse(json);
  assert.equal(embedded.nodes.length, data.vault.nodes.length);
  assert.match(embedded.nodes.find((n) => n.s === 'capabilities/faq').body, /<\/script><script>window\.__pwned/, 'page text round-trips through the inline JSON');
  fs.rmSync(cdnDir, { recursive: true, force: true });

  const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-current-local-'));
  assemble(data, { out: localDir, mode: 'local' });
  for (const f of ['vendor/three/build/three.module.min.js', 'vendor/three/build/three.core.min.js', 'vendor/three/examples/jsm/controls/OrbitControls.js', 'vendor/d3.min.js', 'vendor/lucide.min.js']) {
    assert.ok(fs.existsSync(path.join(localDir, f)), f);
  }
  assert.match(fs.readFileSync(path.join(localDir, 'index.html'), 'utf8'), /"three": "\.\/vendor\/three\/build\/three\.module\.min\.js"/);
  fs.rmSync(localDir, { recursive: true, force: true });
});

test('serve answers on this machine only and refuses paths outside the folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-current-serve-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<p>ok</p>');
  const port = 4900 + Math.floor(Math.random() * 90);
  const child = spawn(process.execPath, [BIN, 'serve', `--dir=${dir}`, `--port=${port}`], { stdio: ['ignore', 'pipe', 'inherit'] });
  try {
    await new Promise((r) => child.stdout.once('data', r));
    const get = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, (r) => { let b = ''; r.on('data', (d) => (b += d)); r.on('end', () => res({ status: r.statusCode, body: b })); }).on('error', rej));
    assert.equal((await get('/')).body, '<p>ok</p>');
    assert.equal((await get('/../../etc/passwd')).status !== 200, true);
    assert.equal((await get('/%2e%2e/%2e%2e/etc/passwd')).status, 403);
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
