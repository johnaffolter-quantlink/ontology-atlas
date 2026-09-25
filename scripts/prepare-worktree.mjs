#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { findMissingSourceCheckoutMcpDependencies } from '../cli/src/lib/mcp-module.mjs';

// A root install does not reach mcp/, so a fresh checkout (a cloud session, a new worktree) started
// its agents with an MCP server that could not load. Install the locked MCP dependencies here when
// they are missing or stale; a failure is reported, never allowed to fail the root install.
// A folder with its own lockfile that the root install does not reach: install it only when its
// dependencies are missing, and only warn on failure so a checkout still prepares offline.
function prepareNestedDependencies({ root, spawn, stderr, env, dir, label, missing }) {
  const needed = missing(join(root, dir));
  if (needed.length === 0) return 0;
  const [command, args] = env.npm_execpath?.includes('pnpm')
    ? [process.execPath, [env.npm_execpath]]
    : ['pnpm', []];
  const installed = spawn(command, [...args, '--dir', dir, 'install', '--frozen-lockfile'], {
    cwd: root,
    stdio: 'inherit',
  });
  if (installed.status !== 0) {
    stderr.write(
      `[prepare] ${label} dependencies (${needed.join(', ')}) did not install; ` +
        `run pnpm --dir ${dir} install --frozen-lockfile\n`,
    );
  }
  return 0;
}

export function prepareMcpDependencies({
  root = process.cwd(),
  spawn = spawnSync,
  stderr = process.stderr,
  missing = findMissingSourceCheckoutMcpDependencies,
  env = process.env,
} = {}) {
  return prepareNestedDependencies({ root, spawn, stderr, env, dir: 'mcp', label: 'MCP', missing });
}

// Atlas Current's pinned libraries (three, d3, lucide), which its local build and the plugin copy.
export function findMissingCurrentDependencies(dir) {
  if (!existsSync(join(dir, 'package.json'))) return [];
  return ['three', 'd3', 'lucide'].filter((name) => !existsSync(join(dir, 'node_modules', name, 'package.json')));
}

export function prepareCurrentDependencies({
  root = process.cwd(),
  spawn = spawnSync,
  stderr = process.stderr,
  missing = findMissingCurrentDependencies,
  env = process.env,
} = {}) {
  return prepareNestedDependencies({ root, spawn, stderr, env, dir: 'packages/atlas-current', label: 'Atlas Current', missing });
}

export function prepareWorktree({ root = process.cwd(), spawn = spawnSync, stderr = process.stderr } = {}) {
  const git = spawn('git', ['rev-parse', '--show-toplevel'], { cwd: root, encoding: 'utf8' });
  if (git.status === 0) {
    const configured = spawn('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'inherit' });
    if (configured.status !== 0) return configured.status ?? 1;
  } else if (git.error?.code !== 'ENOENT' && git.status !== 128) {
    stderr.write(git.stderr ?? git.error?.message ?? '[prepare] git discovery failed\n');
    return git.status ?? 1;
  }

  const built = spawn(process.execPath, ['scripts/build-docs-vault.mjs'], { cwd: root, stdio: 'inherit' });
  if (built.error) stderr.write(`[prepare] ${built.error.message}\n`);
  if (built.status !== 0) return built.status ?? 1;
  prepareMcpDependencies({ root, spawn, stderr });
  return prepareCurrentDependencies({ root, spawn, stderr });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = prepareWorktree();
}
