// Assemble the app: the page, its scripts and the extracted data into one folder that opens anywhere.
//
// mode "local" (default): libraries are copied next to the page from this package's node_modules, so the
//   result works offline from any static server (`atlas-current serve`), with nothing fetched at run time
//   except the optional web fonts, which fall back to system faces.
// mode "cdn": libraries load from pinned CDN URLs, and the page is one self-contained HTML file.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..', 'app');
const require = createRequire(import.meta.url);

const PINS = { three: '0.185.1', d3: '7.9.0', lucide: '1.47.0' };
const CDN = {
  three: `https://cdn.jsdelivr.net/npm/three@${PINS.three}/`,
  d3: `https://cdnjs.cloudflare.com/ajax/libs/d3/${PINS.d3}/d3.min.js`,
  lucide: `https://cdn.jsdelivr.net/npm/lucide@${PINS.lucide}/dist/umd/lucide.min.js`,
};
const D3_TAG = `<script src="${CDN.d3}"></script>`;

// JSON inside <script type="application/json"> must not contain "</" or the tag ends early
const safeJson = (v) => JSON.stringify(v ?? null).replace(/<\//g, '<\\/');

// A package's folder: this package's own node_modules first, then Node's resolution walked up to the
// folder holding package.json (three and d3 do not export their package.json).
function pkgDir(name) {
  const own = path.join(HERE, '..', 'node_modules', name);
  if (fs.existsSync(path.join(own, 'package.json'))) return own;
  try {
    let dir = path.dirname(require.resolve(name));
    while (dir !== path.dirname(dir)) {
      if (fs.existsSync(path.join(dir, 'package.json')) && path.basename(dir) === name) return dir;
      dir = path.dirname(dir);
    }
  } catch {}
  return null;
}

// The three.js add-on files the studio imports, followed through their relative imports, so a build
// carries 18 files instead of the whole examples tree.
function addonClosure(addonsDir) {
  const studio = fs.readFileSync(path.join(APP, 'studio.js'), 'utf8');
  const queue = [...studio.matchAll(/from\s+['"]three\/addons\/([^'"]+)['"]/g)].map((m) => path.normalize(m[1]));
  const seen = new Set();
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const text = fs.readFileSync(path.join(addonsDir, rel), 'utf8');
    for (const m of text.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) queue.push(path.normalize(path.join(path.dirname(rel), m[1])));
  }
  return [...seen].sort();
}

/**
 * Every library file a local build needs, as { src, rel } with `rel` laid out like node_modules
 * (three/build/three.module.js, d3/dist/d3.min.js, ...). Missing packages are reported, not guessed.
 */
export function vendorFiles() {
  const three = pkgDir('three'), d3 = pkgDir('d3'), lucide = pkgDir('lucide');
  const missing = [['three', three], ['d3', d3], ['lucide', lucide]].filter(([, d]) => !d).map(([n]) => n);
  if (missing.length) return { files: [], missing };
  const files = [
    ...['package.json', 'build/three.module.min.js', 'build/three.core.min.js'].map((f) => ({ src: path.join(three, f), rel: `three/${f}` })),
    ...addonClosure(path.join(three, 'examples', 'jsm')).map((f) => ({ src: path.join(three, 'examples', 'jsm', f), rel: `three/examples/jsm/${f.split(path.sep).join('/')}` })),
    ...['package.json', 'dist/d3.min.js'].map((f) => ({ src: path.join(d3, f), rel: `d3/${f}` })),
    ...['package.json', 'dist/umd/lucide.min.js'].map((f) => ({ src: path.join(lucide, f), rel: `lucide/${f}` })),
  ];
  return { files, missing: files.filter((f) => !fs.existsSync(f.src)).map((f) => f.rel) };
}

/**
 * @param {object} data  { vault, code, codeGraph, timeline, semantic, trace, sources, forecast, meta }
 * @param {{ out: string, mode?: 'local' | 'cdn' }} opts
 * @returns {{ index: string, bytes: number, mode: string }}
 */
export function assemble(data, { out, mode = 'local' }) {
  const page = fs.readFileSync(path.join(APP, 'page.html'), 'utf8');
  const script = fs.readFileSync(path.join(APP, 'script.js'), 'utf8');
  const start = page.indexOf('<script>\n(() => {');
  const end = page.indexOf('</script>', start);
  if (start < 0 || end < 0) throw new Error('app/page.html: main script block not found');
  let html = page.slice(0, start) + '<script>\n' + script + '</script>' + page.slice(end + '</script>'.length);

  const slots = {
    __DATA__: data.vault, __CODE__: data.code, __CGR__: data.codeGraph, __TIMELINE__: data.timeline,
    __SEMANTIC__: data.semantic, __TRACE__: data.trace, __SOURCES__: data.sources,
  };
  for (const [slot, value] of Object.entries(slots)) {
    if (!html.includes(slot)) throw new Error(`app/page.html: missing ${slot}`);
    html = html.replace(slot, () => safeJson(value));
  }
  html = html.replace('__SOURCESJS__', () => fs.readFileSync(path.join(APP, 'sources.js'), 'utf8'));
  const extra = `<script type="application/json" id="atlas-forecast">${safeJson(data.forecast)}</script>\n` +
    `<script type="application/json" id="atlas-meta">${safeJson(data.meta)}</script>\n`;
  html = html.replace('<script type="application/json" id="atlas-data">', (m) => extra + m);
  // no favicon request: the page is served from a bare folder
  if (!/rel="icon"/.test(html)) html = html.replace('<meta charset', '<link rel="icon" href="data:,">\n<meta charset');

  const studio = fs.readFileSync(path.join(APP, 'studio.js'), 'utf8').replace('export function createStudio', 'function createStudio') +
    "\nwindow.createAtlasStudio = createStudio;\nwindow.dispatchEvent(new Event('atlas-studio-ready'));\n";
  const live = fs.readFileSync(path.join(APP, 'live.js'), 'utf8');

  fs.mkdirSync(out, { recursive: true });
  let threeBase = CDN.three, d3Src = CDN.d3, lucideSrc = CDN.lucide;
  if (mode === 'local') {
    const { files, missing } = vendorFiles();
    if (missing.length) throw new Error(`local mode needs this package's dependencies (${missing.join(', ')}); run \`pnpm --dir packages/atlas-current install\` or build with --cdn`);
    const vd = path.join(out, 'vendor');
    fs.rmSync(vd, { recursive: true, force: true });
    const place = { 'd3/dist/d3.min.js': 'd3.min.js', 'lucide/dist/umd/lucide.min.js': 'lucide.min.js' };
    for (const f of files) {
      if (f.rel.endsWith('package.json')) continue;
      const dest = path.join(vd, place[f.rel] || f.rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(f.src, dest);
    }
    threeBase = './vendor/three/'; d3Src = './vendor/d3.min.js'; lucideSrc = './vendor/lucide.min.js';
  }
  const importmap = `<script type="importmap">{ "imports": { "three": "${threeBase}build/three.module.min.js", "three/addons/": "${threeBase}examples/jsm/" } }</script>`;
  if (!html.includes(D3_TAG)) throw new Error('app/page.html: d3 script tag not found');
  html = html.replace(D3_TAG, `<script src="${d3Src}"></script>\n<script src="${lucideSrc}"></script>`);
  html = html.replace('<script type="application/json" id="atlas-forecast">', (m) => importmap + '\n' + m);
  html = html.replace(/<\/body>\s*$/, '') + `\n<script>\n${live}</script>\n<script type="module">\n${studio}</script>\n`;

  const index = path.join(out, 'index.html');
  fs.writeFileSync(index, html);
  return { index, bytes: Buffer.byteLength(html), mode };
}
