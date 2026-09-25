#!/usr/bin/env node
// atlas-current: build a navigable, time-aware picture of a repository's ontology vault, and serve it.
//
//   atlas-current build [--repo .] [--vault atlas|docs/ontology] [--ref HEAD] [--out .atlas-current]
//                       [--code-graph cgr.json] [--cdn]
//   atlas-current serve [--dir .atlas-current] [--port 4173]
//
// Everything is read from the repository and its Git history on this machine. Nothing is uploaded.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildData } from '../lib/build-data.mjs';
import { assemble } from '../lib/assemble.mjs';

const [cmd = 'help', ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : true];
}));
const say = (m) => console.log(`[atlas-current] ${m}`);
const fail = (m) => { console.error(`[atlas-current] ${m}`); process.exit(1); };

if (cmd === 'build') {
  const repo = path.resolve(args.repo || '.');
  try { execFileSync('git', ['-C', repo, 'rev-parse', '--git-dir'], { stdio: 'ignore' }); } catch { fail(`${repo} is not a Git repository`); }
  const out = path.resolve(args.out || path.join(repo, '.atlas-current'));
  const t0 = Date.now();
  const data = await buildData({ repo, vault: args.vault, ref: args.ref || 'HEAD', codeGraph: args['code-graph'] ? path.resolve(args['code-graph']) : null, services: args.services ? path.resolve(args.services) : null, log: say });
  const { index, bytes, mode } = assemble(data, { out, mode: args.cdn ? 'cdn' : 'local' });
  if (args['keep-data']) fs.writeFileSync(path.join(out, 'data.json'), JSON.stringify(data));
  say(`built ${index} (${(bytes / 1024).toFixed(0)} KB, ${mode}) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  say(mode === 'local' ? `open it: atlas-current serve --dir ${path.relative(process.cwd(), out) || '.'}` : `open ${index} in a browser`);
} else if (cmd === 'audit') {
  // the forecast's checks, printed: which part of its score survives each assumption being removed
  const repo = path.resolve(args.repo || '.');
  const data = await buildData({ repo, vault: args.vault, ref: args.ref || 'HEAD', codeGraph: args['code-graph'] ? path.resolve(args['code-graph']) : null });
  const a = data.forecast.audit;
  if (!a?.ok) fail(a?.reason || 'no forecast: not enough history');
  console.log(JSON.stringify(args.json ? a : { ...a, flags: undefined }, null, 2));
  if (!args.json) { console.log(a.flags.length ? '\nflags:' : '\nno flags'); for (const f of a.flags) console.log(`  - ${f}`); }
} else if (cmd === 'serve') {
  const dir = path.resolve(args.dir || '.atlas-current');
  if (!fs.existsSync(path.join(dir, 'index.html'))) fail(`no index.html in ${dir}; run atlas-current build first`);
  const port = Number(args.port || 4173);
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm' };
  http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const file = path.normalize(path.join(dir, url === '/' ? 'index.html' : url));
    if (!file.startsWith(dir + path.sep) && file !== path.join(dir, 'index.html')) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404).end('not found'); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(body);
    });
  }).listen(port, '127.0.0.1', () => say(`serving ${dir} at http://127.0.0.1:${port}/ (this machine only)`));
} else {
  console.log(`atlas-current build [--repo .] [--vault <dir>] [--ref HEAD] [--out .atlas-current] [--code-graph cgr.json] [--services services.json] [--cdn] [--keep-data]
atlas-current audit [--repo .] [--ref HEAD] [--code-graph cgr.json] [--json]
atlas-current serve [--dir .atlas-current] [--port 4173]`);
  if (cmd !== 'help') process.exit(1);
}
