// Opens a built Atlas Current in headless Chromium, clicks through every view, and fails on any page
// error. Usage: node test/render-smoke.mjs <built dir> [screenshot dir]
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const dir = path.resolve(process.argv[2] || '.atlas-current');
const shots = process.argv[3] ? path.resolve(process.argv[3]) : null;
const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'atlas-current.mjs');
const port = 4300 + Math.floor(Math.random() * 500);
const server = spawn(process.execPath, [bin, 'serve', `--dir=${dir}`, `--port=${port}`], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((r) => server.stdout.once('data', r));
const errors = [];
// SMOKE_CHROMIUM points at a browser when the installed one does not match this Playwright's build.
const browser = await chromium.launch({ executablePath: process.env.SMOKE_CHROMIUM || undefined, timeout: 30000, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}\n${(e.stack || "").split("\n").slice(1, 4).join("\n")}`));
  const fonts = /fonts\.(googleapis|gstatic)\.com/;
  page.on('console', (m) => { if (m.type() === 'error' && !fonts.test(m.location()?.url || '')) errors.push(`console: ${m.text()} ${m.location()?.url || ''}`); });
  page.on('response', (r) => { if (r.status() >= 400 && !fonts.test(r.url())) errors.push(`http ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', (r) => { if (!fonts.test(r.url())) errors.push(`request failed: ${r.url()}`); });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const views = await page.$$eval('[data-view]', (els) => [...new Set(els.map((e) => e.getAttribute('data-view')))]);
  for (const v of views) {
    await page.click(`[data-view="${v}"]`);
    await page.waitForTimeout(v === 'studio' ? 4000 : 1500);
    if (shots) await page.screenshot({ path: path.join(shots, `view-${v}.png`) });
  }
  console.log(`views: ${views.join(', ')}`);
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log('render smoke: no page errors');
