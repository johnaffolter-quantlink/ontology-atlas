import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveVault } from '../plugins/ontology-atlas/launch.mjs';

function project(...vaults) {
  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-plugin-resolve-'));
  for (const vault of vaults) mkdirSync(path.join(dir, vault), { recursive: true });
  return dir;
}

test('the plugin finds ./atlas before docs/ontology, always as an absolute path', () => {
  const dir = project('atlas', 'docs/ontology');
  try {
    assert.deepEqual(resolveVault({ env: {}, projectDir: dir }).vault, path.join(dir, 'atlas'));
    rmSync(path.join(dir, 'atlas'), { recursive: true });
    assert.equal(resolveVault({ env: {}, projectDir: dir }).vault, path.join(dir, 'docs', 'ontology'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('OATLAS_VAULT wins, resolved against the project, and is not second-guessed', () => {
  const dir = project('atlas', 'elsewhere');
  try {
    assert.equal(resolveVault({ env: { OATLAS_VAULT: 'elsewhere' }, projectDir: dir }).vault, path.join(dir, 'elsewhere'));
    const missing = resolveVault({ env: { OATLAS_VAULT: 'nope' }, projectDir: dir });
    assert.equal(missing.vault, null, 'an explicit vault that does not exist is reported, not replaced by ./atlas');
    assert.deepEqual(missing.tried, [path.join(dir, 'nope')]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a project without a vault reports every place it looked', () => {
  const dir = project();
  try {
    assert.deepEqual(resolveVault({ env: {}, projectDir: dir }), {
      vault: null,
      tried: [path.join(dir, 'atlas'), path.join(dir, 'docs', 'ontology')],
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
