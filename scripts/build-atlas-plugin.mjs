#!/usr/bin/env node
/**
 * Builds the Claude Code plugin and a one-plugin marketplace around it, then proves both install
 * cases work. Nothing is published and nothing outside `--out` is written.
 *
 *   pnpm plugin:build                          # → .tmp/atlas-plugin, verified
 *   pnpm plugin:build -- --out=<dir>           # somewhere else
 *   pnpm plugin:build -- --bundle=<file.mcpb>  # reuse an already-verified bundle
 *
 * The server is not copied from mcp/: it is unpacked from the `.mcpb` that `mcp:build-bundle`
 * builds and boots, so the plugin carries exactly the bytes that were verified. The plugin's own
 * files (manifest, launcher, skills) live in plugins/ontology-atlas/; the built server never goes
 * into Git, so there is no second copy of the server to drift.
 *
 * fail-closed, three proofs:
 *   1. `claude plugin validate` accepts the plugin and the marketplace (skipped, and said so, when
 *      the claude CLI is absent);
 *   2. a project with no vault gets exactly one tool, `atlas_status`, naming where it looked;
 *   3. a project whose vault is ./atlas gets the full server, and `connection_info` reports that
 *      vault's absolute path even though the process starts in another directory.
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const SOURCE = path.join(ROOT, 'plugins', 'ontology-atlas');
const SAMPLE_VAULT = path.join(ROOT, 'samples', 'storefront');
const args = Object.fromEntries(
  process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  }),
);
const OUT = path.resolve(args.out || path.join(ROOT, '.tmp', 'atlas-plugin'));
const PLUGIN = path.join(OUT, 'plugins', 'ontology-atlas');

function fail(message) {
  console.error(`[atlas-plugin] ${message}`);
  process.exit(1);
}
const note = (message) => console.log(`[atlas-plugin] ${message}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function bundlePath() {
  if (args.bundle) return path.resolve(args.bundle);
  const built = spawnSync(process.execPath, ['scripts/build-mcp-bundle.mjs'], { cwd: ROOT, stdio: 'inherit' });
  if (built.status !== 0) fail('mcp:build-bundle failed; the plugin reuses its verified artifact');
  const dir = path.join(ROOT, '.tmp', 'mcp-bundle');
  const version = readJson(path.join(ROOT, 'mcp', 'package.json')).version;
  const file = path.join(dir, `ontology-atlas-mcp-${version}.mcpb`);
  if (!existsSync(file)) fail(`expected ${file} after mcp:build-bundle`);
  return file;
}

function assemble(bundle) {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(path.dirname(PLUGIN), { recursive: true });
  cpSync(SOURCE, PLUGIN, { recursive: true });
  const unzipped = spawnSync('unzip', ['-q', bundle, 'server/*', '-d', PLUGIN], { encoding: 'utf8' });
  if (unzipped.status !== 0) fail(`could not unpack the server from ${bundle}: ${unzipped.stderr}`);
  const version = readJson(path.join(PLUGIN, 'server', 'package.json')).version;
  const manifestPath = path.join(PLUGIN, '.claude-plugin', 'plugin.json');
  const manifest = readJson(manifestPath);
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
  mkdirSync(path.join(OUT, '.claude-plugin'), { recursive: true });
  writeFileSync(
    path.join(OUT, '.claude-plugin', 'marketplace.json'),
    `${JSON.stringify(
      {
        name: 'ontology-atlas',
        owner: { name: 'Ontology Atlas' },
        description: 'Ontology Atlas for Claude Code',
        plugins: [{ name: 'ontology-atlas', source: './plugins/ontology-atlas', description: manifest.description, version }],
      },
      null,
      2,
    )}\n`,
  );
  return version;
}

function validateWithClaude() {
  const probe = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (probe.status !== 0) return note('claude CLI not found; skipped `claude plugin validate`');
  for (const target of [PLUGIN, OUT]) {
    const res = spawnSync('claude', ['plugin', 'validate', target], { encoding: 'utf8' });
    if (res.status !== 0) fail(`claude plugin validate ${target} failed:\n${res.stdout}${res.stderr}`);
  }
  note('claude plugin validate: plugin and marketplace accepted ✓');
}

// Starts the launcher the way a host does and returns each response by request id.
function talk(env, requests, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(PLUGIN, 'launch.mjs')], {
      cwd,
      env: { ...process.env, OATLAS_VAULT: '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const replies = new Map();
    let buffer = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no answer within 30 s; stderr: ${stderr}`));
    }, 30_000);
    child.stderr.on('data', (d) => (stderr += d));
    child.stdout.on('data', (d) => {
      buffer += d;
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const msg = JSON.parse(line);
        if (msg.id !== undefined) replies.set(msg.id, msg);
        if (replies.size === requests.filter((r) => r.id !== undefined).length) {
          clearTimeout(timer);
          child.kill();
          resolve(replies);
        }
      }
    });
    for (const r of requests) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...r })}\n`);
  });
}

const init = { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'atlas-plugin-build', version: '1' } } };
const initialized = { method: 'notifications/initialized' };
const toolText = (reply) => (reply?.result?.content ?? []).map((c) => c.text).join('\n');

async function proveNoVault() {
  const project = mkdtempSync(path.join(tmpdir(), 'atlas-plugin-novault-'));
  try {
    const r = await talk({ ATLAS_PROJECT_DIR: project }, [init, initialized, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'atlas_status', arguments: {} } }], tmpdir());
    const names = (r.get(2)?.result?.tools ?? []).map((t) => t.name);
    if (names.join() !== 'atlas_status') fail(`no-vault project: expected only atlas_status, got ${names.join(', ') || 'nothing'}`);
    const status = toolText(r.get(3));
    for (const expected of [path.join(project, 'atlas'), path.join(project, 'docs', 'ontology')]) {
      if (!status.includes(expected)) fail(`no-vault status does not name ${expected}:\n${status}`);
    }
    if (!(r.get(1)?.result?.instructions ?? '').includes('No Atlas vault')) fail('no-vault initialize carries no instructions');
    note('no vault: one tool, atlas_status, naming both places it looked ✓');
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

async function proveSeededVault() {
  const project = mkdtempSync(path.join(tmpdir(), 'atlas-plugin-vault-'));
  try {
    cpSync(SAMPLE_VAULT, path.join(project, 'atlas'), { recursive: true });
    const r = await talk(
      { ATLAS_PROJECT_DIR: project },
      [init, initialized, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'connection_info', arguments: {} } }, { id: 4, method: 'tools/call', params: { name: 'list_kinds', arguments: {} } }],
      tmpdir(), // not the project: the vault must come from ATLAS_PROJECT_DIR, not the cwd
    );
    const names = (r.get(2)?.result?.tools ?? []).map((t) => t.name);
    const count = names.length;
    if (count < 2 || !names.includes('list_kinds') || !names.includes('connection_info')) {
      fail(`seeded vault: the full server did not answer (tools: ${names.join(', ') || 'none'})`);
    }
    const info = toolText(r.get(3));
    if (!info.includes(path.join(project, 'atlas'))) fail(`connection_info does not report ${path.join(project, 'atlas')}:\n${info.slice(0, 400)}`);
    if (r.get(4)?.result?.isError || !toolText(r.get(4))) fail(`list_kinds failed on the seeded vault: ${JSON.stringify(r.get(4)).slice(0, 400)}`);
    note(`seeded ./atlas: ${count} tools, vault ${path.join(project, 'atlas')} (started from ${tmpdir()}) ✓`);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

const version = assemble(bundlePath());
validateWithClaude();
await proveNoVault();
await proveSeededVault();
note(`built ${OUT} (plugin ontology-atlas ${version})`);
note(`try it: claude --plugin-dir ${PLUGIN}`);
