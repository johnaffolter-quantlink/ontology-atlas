#!/usr/bin/env node
// Starts the Atlas MCP server for the project the host opened, or, when that project has no
// vault, a stand-in that says so. Without the stand-in a missing vault makes the server exit at
// startup: the host shows no Atlas tools and the agent never learns why.
//
// Vault, first match wins: OATLAS_VAULT; <project>/atlas (what `ontology-atlas init` creates);
// <project>/docs/ontology. The project is ATLAS_PROJECT_DIR (the host's project directory),
// else the working directory. The path handed to the server is always absolute.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const project = path.resolve(process.env.ATLAS_PROJECT_DIR || process.cwd());
const isDir = (dir) => existsSync(dir) && statSync(dir).isDirectory();

export function resolveVault({ env = process.env, projectDir = project } = {}) {
  const tried = [];
  if (env.OATLAS_VAULT) {
    const explicit = path.resolve(projectDir, env.OATLAS_VAULT);
    return isDir(explicit) ? { vault: explicit, tried: [explicit] } : { vault: null, tried: [explicit] };
  }
  for (const candidate of ['atlas', path.join('docs', 'ontology')]) {
    const dir = path.join(projectDir, candidate);
    tried.push(dir);
    if (isDir(dir)) return { vault: dir, tried };
  }
  return { vault: null, tried };
}

function serverVersion() {
  try {
    return JSON.parse(readFileSync(path.join(here, 'server', 'package.json'), 'utf8')).version;
  } catch {
    return 'unknown';
  }
}

// A minimal stdio MCP server with one read-only tool. It never creates a vault: making one is
// the person's decision, so it only explains how.
function serveMissingVault(tried) {
  const where = tried.map((dir) => `- ${dir}`).join('\n');
  const status =
    `No Atlas vault was found for ${project}. Looked in:\n${where}\n\n` +
    'Atlas tools stay unavailable until a vault exists. Tell the person, and do not create one ' +
    'unless they ask. To start one, they can scaffold it with the ontology-atlas CLI ' +
    '(`ontology-atlas init` creates ./atlas) or point OATLAS_VAULT at an existing vault, then ' +
    'restart the session.';
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      return;
    }
    const { id, method, params } = request;
    if (id === undefined) return; // notifications need no answer
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'ontology-atlas-mcp', version: serverVersion() },
          instructions: status,
        },
      });
    } else if (method === 'tools/list') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: 'atlas_status',
              description: 'Why Atlas tools are unavailable in this project, and how the person can enable them.',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: true },
            },
          ],
        },
      });
    } else if (method === 'tools/call' && params?.name === 'atlas_status') {
      send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: status }] } });
    } else if (method === 'ping') {
      send({ jsonrpc: '2.0', id, result: {} });
    } else {
      send({ jsonrpc: '2.0', id, error: { code: -32601, message: `${method} is unavailable: ${status}` } });
    }
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const { vault, tried } = resolveVault();
  if (vault) {
    process.env.OATLAS_VAULT = vault;
    // the server finds the repository root from its working directory
    process.chdir(project);
    await import(pathToFileURL(path.join(here, 'server', 'src', 'index.js')).href);
  } else {
    serveMissingVault(tried);
  }
}
