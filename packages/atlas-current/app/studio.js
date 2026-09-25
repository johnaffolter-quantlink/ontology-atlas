/**
 * Studio: the same data as physical objects on a dark stage.
 * Pages are paper printed with their real text, routes are phones showing their real UI,
 * domains are machined plinths, elements are anodised tokens, tools are milled keys, logs are
 * receipt rolls, commits are index cards, and dependencies are cables lying on the floor.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { TAARenderPass } from 'three/addons/postprocessing/TAARenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const F = { serif: '"Source Serif 4", Georgia, serif', sans: 'Geist, system-ui, sans-serif', mono: '"Geist Mono", ui-monospace, monospace' };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KIND = { domain: 'Domain', capability: 'Capability', element: 'Element', architecture: 'Architecture', route: 'Route', view: 'View', widget: 'Widget', feature: 'Feature', entity: 'Entity', intent: 'Intent', prompt: 'Prompt', desktop: 'Desktop command', jsonl: 'JSONL log', mcp: 'MCP tool', meaning: 'Capability', decision: 'Decision', commit: 'Commit' };

// ------------------------------------------------------------------ canvas printing
function wrap(g, text, x, y, maxW, lh, maxLines) {
  const words = String(text || '').split(/\s+/); let line = '', n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (g.measureText(test).width > maxW && line) {
      if (++n >= maxLines) { g.fillText(line.replace(/[,.;:]?$/, '…'), x, y); return y + lh; }
      g.fillText(line, x, y); y += lh; line = words[i];
    } else line = test;
  }
  if (line) { g.fillText(line, x, y); y += lh; }
  return y;
}
function grainFill(g, w, h, base, amount, seed = 7) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h), d = img.data; let s = seed;
  for (let i = 0; i < d.length; i += 4) { s = (s * 1664525 + 1013904223) >>> 0; const v = ((s >>> 24) / 255 - 0.5) * amount; d[i] += v; d[i + 1] += v; d[i + 2] += v; }
  g.putImageData(img, 0, 0);
}
function tex(canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.generateMipmaps = true;
  return t;
}
/** A page as printed paper: letterhead, title, standfirst, metadata, relations, folio. */
function printPage(n, rel, W = 360) {
  const H = Math.round(W * 1.294), s = W / 640, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  grainFill(g, W, H, '#e9e8e3', 7, n.s.length);
  const L = 52 * s, R = W - 52 * s, ink = '#1c1d20', ink2 = '#5a5d64';
  g.fillStyle = ink2; g.font = `500 ${11 * s}px ${F.sans}`; g.textBaseline = 'alphabetic';
  g.fillText(`ONTOLOGY ATLAS · ${(KIND[n.k] || n.k).toUpperCase()}`, L, 58 * s);
  g.textAlign = 'right'; g.font = `${10 * s}px ${F.mono}`; g.fillText((n.file || n.s).slice(-46), R, 58 * s); g.textAlign = 'left';
  g.fillStyle = ink; g.fillRect(L, 68 * s, R - L, Math.max(1, 1.2 * s));
  g.font = `600 ${34 * s}px ${F.serif}`; let y = wrap(g, n.t, L, 118 * s, R - L, 38 * s, 3);
  if (n.ko) { g.fillStyle = ink2; g.font = `${15 * s}px ${F.sans}`; y = wrap(g, n.ko, L, y + 2 * s, R - L, 20 * s, 1); }
  g.fillStyle = '#2c2e33'; g.font = `${17 * s}px ${F.serif}`; y = wrap(g, n.desc || '', L, y + 16 * s, R - L, 25 * s, 7);
  y += 12 * s; g.fillStyle = '#d6d6d0'; g.fillRect(L, y, R - L, 1); y += 22 * s;
  const meta = [['Implementation', n.p], ['Domain', rel.domain], ['Depends on', rel.deps.join(', ')], ['Holds', rel.holds.join(', ')], ['UID', n.uid ? n.uid.split('-')[0] : 'not minted']].filter(r => r[1]);
  for (const [k, v] of meta) {
    g.fillStyle = ink2; g.font = `${11.5 * s}px ${F.sans}`; g.fillText(k, L, y);
    g.fillStyle = ink; g.font = `${11 * s}px ${F.mono}`; y = wrap(g, v, L + 132 * s, y, R - L - 132 * s, 16 * s, 2) + 4 * s;
  }
  // the real implementation, printed as a listing: gutter numbers, the file's own lines
  const code = (window.__atlasCode || {})[n.s], bottom = H - 72 * s;
  if (code && bottom - y > 90 * s) {
    y += 10 * s;
    g.fillStyle = ink2; g.font = `500 ${10 * s}px ${F.sans}`; g.fillText('LISTING', L, y);
    g.textAlign = 'right'; g.font = `${9.5 * s}px ${F.mono}`; g.fillText(`${code.file} · ${code.lines} lines`.slice(-58), R, y); g.textAlign = 'left';
    y += 8 * s;
    const top = y, lh = 12.5 * s, gut = 30 * s;
    g.fillStyle = 'rgba(28,29,32,0.045)'; g.fillRect(L, top, R - L, bottom - top);
    g.fillStyle = 'rgba(28,29,32,0.10)'; g.fillRect(L + gut, top, Math.max(1, 0.8 * s), bottom - top);
    g.save(); g.beginPath(); g.rect(L, top, R - L, bottom - top); g.clip();
    let ly = top + 13 * s;
    for (const [si, sg] of code.segments.entries()) {
      if (si) { g.fillStyle = ink2; g.font = `${9 * s}px ${F.mono}`; g.fillText('⋮', L + gut + 8 * s, ly); ly += lh; }
      for (const [j, line] of sg.lines.entries()) {
        if (ly > bottom - 4 * s) break;
        const note = /^\s*(\*|\/\*\*?|\/\/|\*\/)/.test(line);
        g.fillStyle = '#9a9b9f'; g.font = `${8.5 * s}px ${F.mono}`; g.textAlign = 'right'; g.fillText(String(sg.start + j), L + gut - 6 * s, ly); g.textAlign = 'left';
        g.fillStyle = note ? '#6d7078' : ink; g.font = `${note ? 'italic ' : ''}${9.4 * s}px ${F.mono}`;
        g.fillText(line.slice(0, 74), L + gut + 8 * s, ly); ly += lh;
      }
    }
    g.restore();
    // a fade where the page cuts the listing off, like a printout folded under
    const fade = g.createLinearGradient(0, bottom - 26 * s, 0, bottom); fade.addColorStop(0, 'rgba(233,232,227,0)'); fade.addColorStop(1, 'rgba(233,232,227,0.95)');
    g.fillStyle = fade; g.fillRect(L, bottom - 26 * s, R - L, 26 * s);
  }
  g.fillStyle = '#d6d6d0'; g.fillRect(L, H - 58 * s, R - L, 1);
  g.fillStyle = ink2; g.font = `${10 * s}px ${F.mono}`; g.fillText(n.s, L, H - 36 * s);
  const last = code?.commits?.[0];
  if (last) { g.textAlign = 'right'; g.fillText(`last change ${last.h} · ${last.d}`, R, H - 36 * s); g.textAlign = 'left'; }
  return c;
}
// ------------------------------------------------------------------ surfaces: procedural, tileable, physical
function hash2(x, y) { let h = x * 374761393 + y * 668265263; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function valueNoise(x, y, period) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, w = v => v * v * (3 - 2 * v);
  const p = v => ((v % period) + period) % period;
  const a = hash2(p(xi), p(yi)), b = hash2(p(xi + 1), p(yi)), c = hash2(p(xi), p(yi + 1)), d = hash2(p(xi + 1), p(yi + 1));
  return a + (b - a) * w(xf) + (c - a) * w(yf) + (a - b - c + d) * w(xf) * w(yf);
}
function heightField(size, fn) { const h = new Float32Array(size * size); for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) h[y * size + x] = fn(x, y); return h; }
function toCanvas(size, px) { const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), img = g.createImageData(size, size); for (let i = 0; i < size * size; i++) { const [r, gg, b] = px(i); img.data[i * 4] = r; img.data[i * 4 + 1] = gg; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; } g.putImageData(img, 0, 0); return c; }
function normalFrom(h, size, strength) {
  return toCanvas(size, i => {
    const x = i % size, y = (i / size) | 0, at = (a, b) => h[((b + size) % size) * size + ((a + size) % size)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    return [(-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255];
  });
}
function surfaceTex(canvas, repeat, srgb = false) {
  const t = new THREE.CanvasTexture(canvas); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; return t;
}
const SURF = (() => {
  const S = 256;
  // paper: cellulose fibres on a fine tooth
  const fib = heightField(S, (x, y) => 0.55 * valueNoise(x / 3, y / 3, S / 3) + 0.3 * valueNoise(x / 1.2, y / 1.2, Math.round(S / 1.2)) + 0.15 * valueNoise(x / 9, y / 18, Math.round(S / 9)));
  // brushed aluminium: long grain along x, fine across y
  const brush = heightField(S, (x, y) => 0.7 * valueNoise(x / 64, y / 0.9, 4) + 0.3 * valueNoise(x / 16, y / 0.6, 16));
  // studio sweep: slow mottling plus tooth
  const sweep = heightField(S, (x, y) => 0.6 * valueNoise(x / 48, y / 48, S / 48) + 0.4 * valueNoise(x / 2, y / 2, S / 2));
  return {
    paperN: normalFrom(fib, S, 2.2),
    brushN: normalFrom(brush, S, 1.6),
    brushR: toCanvas(S, i => { const v = 90 + brush[i] * 60; return [v, v, v]; }),
    sweepR: toCanvas(S, i => { const v = 170 + sweep[i] * 70; return [v, v, v]; }),
    sweepN: normalFrom(sweep, S, 0.8),
  };
})();

// ------------------------------------------------------------------ icons: Lucide, drawn onto screens
const ICON_CACHE = new Map();
function iconSvg(name, color, size = 24, stroke = 2) {
  const node = window.lucide?.icons?.[name]; if (!node) return null;
  const inner = node.map(([tag, attrs]) => `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
function iconImage(name, color) {
  const k = `${name}|${color}`;
  if (ICON_CACHE.has(k)) return ICON_CACHE.get(k);
  const svg = iconSvg(name, color, 96); if (!svg) return null;
  const img = new Image(); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  const entry = { img, ready: img.decode().then(() => true, () => false) };
  ICON_CACHE.set(k, entry); return entry;
}
const ICON_RULES = [[/close|dismiss/i, 'X'], [/cancel/i, 'X'], [/remove|delete|discard|forget/i, 'Trash2'], [/finder|open/i, 'ExternalLink'], [/retry|again|reload|reset|refresh/i, 'RotateCw'], [/download/i, 'Download'], [/play|resume|run|start|continue/i, 'Play'], [/pause|stop/i, 'Pause'], [/draft|write|edit|update|rename/i, 'PenLine'], [/fold|collapse/i, 'ChevronsUp'], [/back/i, 'ArrowLeft'], [/map/i, 'Map'], [/add|new|create/i, 'Plus'], [/filter/i, 'ListFilter'], [/folder|pick/i, 'FolderOpen'], [/ask|chat|message|agent/i, 'MessageCircle'], [/copy/i, 'Copy'], [/search|find/i, 'Search'], [/save/i, 'Save'], [/send|share/i, 'Send'], [/check|verify|doctor|guard/i, 'Stethoscope'], [/install/i, 'PackagePlus'], [/connect/i, 'Plug'], [/setting|config/i, 'Settings'], [/git|commit/i, 'GitCommitHorizontal'], [/where|locate/i, 'LocateFixed'], [/not working|help/i, 'LifeBuoy'], [/undo/i, 'Undo2'], [/fix/i, 'Wrench'], [/analy|insight/i, 'ChartNoAxesColumn'], [/view|show|preview/i, 'Eye'], [/link/i, 'Link']];
const iconFor = label => (ICON_RULES.find(([re]) => re.test(label || '')) || [0, 'CircleDot'])[1];
const KIND_ICON = { route: 'Smartphone', view: 'PanelsTopLeft', widget: 'LayoutGrid', feature: 'Zap', entity: 'Database', intent: 'Compass', prompt: 'MessageSquareText', mcp: 'Plug', desktop: 'Monitor', jsonl: 'ScrollText', meaning: 'FileText', decision: 'Scale' };
const ALL_ICONS = [...new Set([...ICON_RULES.map(r => r[1]), 'CircleDot', 'ChevronRight', 'ChevronLeft', 'Signal', 'Wifi', 'BatteryFull', ...Object.values(KIND_ICON)])];
const iconsReady = () => Promise.all(ALL_ICONS.flatMap(n => ['#f5f5f5', '#8f8f8f', '#0b0b0b'].map(c => iconImage(n, c)?.ready)));
function drawIcon(g, name, x, y, size, color) { const e = iconImage(name, color); if (e && e.img.complete && e.img.naturalWidth) g.drawImage(e.img, x, y, size, size); }

/**
 * One screen of the real app, as a phone renders it: a status bar with the real time, the
 * route or module as the page title, its real buttons with icons, what it opens and what it
 * talks to. Returns the canvas and the tap targets drawn on it, in canvas pixels.
 */
function printPhone(screen, W, H, state) {
  const c = state.canvas || (state.canvas = document.createElement('canvas'));
  c.width = W; c.height = H; const g = c.getContext('2d'), s = W / 390, hits = [];
  g.fillStyle = '#0a0a0a'; g.fillRect(0, 0, W, H);
  // status bar: real local time, signal, wifi, battery; the island is cut from the glass itself
  const now = new Date(), hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
  g.fillStyle = '#f5f5f5'; g.font = `600 ${16 * s}px ${F.sans}`; g.fillText(`${hh}:${mm}`, 30 * s, 34 * s);
  drawIcon(g, 'Signal', W - 98 * s, 20 * s, 17 * s, '#f5f5f5'); drawIcon(g, 'Wifi', W - 76 * s, 20 * s, 17 * s, '#f5f5f5'); drawIcon(g, 'BatteryFull', W - 52 * s, 19 * s, 22 * s, '#f5f5f5');
  let y = 64 * s;
  if (state.stack.length > 1) {
    drawIcon(g, 'ChevronLeft', 14 * s, y - 2 * s, 24 * s, '#f5f5f5');
    g.fillStyle = '#f5f5f5'; g.font = `${16 * s}px ${F.sans}`; g.fillText(state.parentLabel, 38 * s, y + 16 * s);
    hits.push({ x: 0, y: y - 10 * s, w: 220 * s, h: 40 * s, act: 'back' });
  } else { g.fillStyle = '#8f8f8f'; g.font = `${12 * s}px ${F.mono}`; g.fillText('ontology-atlas', 20 * s, y + 14 * s); }
  y += 44 * s;
  drawIcon(g, KIND_ICON[screen.kind] || 'CircleDot', 20 * s, y - 2 * s, 22 * s, '#8f8f8f');
  g.fillStyle = '#8f8f8f'; g.font = `500 ${12 * s}px ${F.mono}`; g.fillText((KIND[screen.kind] || screen.kind).toUpperCase(), 48 * s, y + 14 * s);
  y += 30 * s;
  g.fillStyle = '#f5f5f5'; g.font = `700 ${31 * s}px ${F.sans}`; y = wrap(g, screen.title, 20 * s, y + 26 * s, W - 40 * s, 36 * s, 2);
  if (screen.sub) { g.fillStyle = '#8f8f8f'; g.font = `${12 * s}px ${F.mono}`; y = wrap(g, screen.sub, 20 * s, y + 2 * s, W - 40 * s, 16 * s, 2); }
  y += 14 * s;
  const section = label => { g.fillStyle = '#6a6a6a'; g.font = `600 ${11.5 * s}px ${F.sans}`; if ('letterSpacing' in g) g.letterSpacing = `${0.8 * s}px`; g.fillText(label.toUpperCase(), 20 * s, y + 12 * s); if ('letterSpacing' in g) g.letterSpacing = '0px'; y += 24 * s; };
  if (screen.controls.length) {
    section(`Controls · ${screen.controlCount}`);
    let x = 20 * s;
    for (const [i, b] of screen.controls.entries()) {
      g.font = `500 ${15 * s}px ${F.sans}`;
      const w = Math.min(W - 40 * s, g.measureText(b.label).width + 58 * s);
      if (x + w > W - 20 * s) { x = 20 * s; y += 50 * s; }
      if (y > H - 260 * s) break;
      const pressed = state.pressed === i && performance.now() < state.pressedUntil;
      g.fillStyle = pressed ? '#f5f5f5' : '#1b1b1b'; g.strokeStyle = '#2e2e2e'; g.lineWidth = 1 * s;
      g.beginPath(); g.roundRect(x, y, w, 40 * s, 12 * s); g.fill(); if (!pressed) g.stroke();
      drawIcon(g, iconFor(b.label), x + 12 * s, y + 10 * s, 20 * s, pressed ? '#0b0b0b' : '#f5f5f5');
      g.fillStyle = pressed ? '#0b0b0b' : '#f5f5f5'; g.fillText(b.label, x + 40 * s, y + 26 * s);
      hits.push({ x, y, w, h: 40 * s, act: 'press', index: i });
      x += w + 8 * s;
    }
    y += 58 * s;
  }
  const rows = (label, list, go) => {
    if (!list.length || y > H - 160 * s) return;
    section(label);
    g.fillStyle = '#141414'; const top = y, n = Math.min(list.length, Math.floor((H - 120 * s - y) / (52 * s)));
    g.beginPath(); g.roundRect(14 * s, top, W - 28 * s, n * 52 * s, 14 * s); g.fill();
    list.slice(0, n).forEach((r, i) => {
      const ry = top + i * 52 * s;
      if (i) { g.fillStyle = '#232323'; g.fillRect(56 * s, ry, W - 70 * s, 1); }
      drawIcon(g, KIND_ICON[r.kind] || 'CircleDot', 26 * s, ry + 15 * s, 22 * s, '#f5f5f5');
      g.fillStyle = '#f5f5f5'; g.font = `500 ${15.5 * s}px ${F.sans}`; g.fillText(r.label.length > 26 ? r.label.slice(0, 25) + '…' : r.label, 58 * s, ry + 23 * s);
      g.fillStyle = '#8f8f8f'; g.font = `${11.5 * s}px ${F.mono}`; g.fillText(r.meta, 58 * s, ry + 40 * s);
      if (go) { drawIcon(g, 'ChevronRight', W - 46 * s, ry + 15 * s, 20 * s, '#6a6a6a'); hits.push({ x: 14 * s, y: ry, w: W - 28 * s, h: 52 * s, act: 'open', id: r.id }); }
    });
    y = top + n * 52 * s + 18 * s;
  };
  rows('Opens', screen.opens, true);
  rows('Talks to', screen.talks, false);
  // a toast: what the tapped control really runs, and where the code is
  if (state.toast && performance.now() < state.toastUntil) {
    const tw = W - 40 * s, th = 76 * s, ty = H - 120 * s;
    g.fillStyle = 'rgba(245,245,245,0.97)'; g.beginPath(); g.roundRect(20 * s, ty, tw, th, 18 * s); g.fill();
    drawIcon(g, 'Zap', 34 * s, ty + 16 * s, 20 * s, '#0b0b0b');
    g.fillStyle = '#0b0b0b'; g.font = `600 ${15 * s}px ${F.sans}`; g.fillText(state.toast.title, 62 * s, ty + 31 * s);
    g.fillStyle = '#4a4a4a'; g.font = `${12 * s}px ${F.mono}`; g.fillText(state.toast.where, 62 * s, ty + 54 * s);
  }
  g.fillStyle = '#f5f5f5'; g.beginPath(); g.roundRect(W / 2 - 67 * s, H - 14 * s, 134 * s, 5 * s, 3 * s); g.fill();
  return { canvas: c, hits };
}
function printEngraving(text, W, H, { fg = 'rgba(20,20,20,0.85)', size = 0.34, font = F.mono, tracking = 3 } = {}) {
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = fg; g.font = `500 ${H * size}px ${font}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = `${tracking}px`;
  const lines = String(text).toUpperCase().split('\n');
  lines.forEach((l, i) => { let t = l; while (g.measureText(t).width > W * 0.9 && t.length > 4) t = t.slice(0, -2); g.fillText(t === l ? l : t + '…', W / 2, H / 2 + (i - (lines.length - 1) / 2) * H * size * 1.2); });
  return c;
}
function printCard(cm, W = 512) {
  const H = Math.round(W * 0.6), s = W / 512, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  grainFill(g, W, H, '#e8e7e1', 6, cm.h.length * 31);
  g.strokeStyle = 'rgba(0,0,0,0.09)'; g.lineWidth = 1; for (let y = 78 * s; y < H - 10; y += 26 * s) { g.beginPath(); g.moveTo(18 * s, y); g.lineTo(W - 18 * s, y); g.stroke(); }
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.moveTo(18 * s, 54 * s); g.lineTo(W - 18 * s, 54 * s); g.stroke();
  g.fillStyle = '#1c1d20'; g.font = `600 ${22 * s}px ${F.mono}`; g.fillText(cm.h.slice(0, 7), 24 * s, 40 * s);
  g.fillStyle = '#5a5d64'; g.font = `${14 * s}px ${F.mono}`; g.textAlign = 'right'; g.fillText(`${cm.d.slice(0, 10)} · ${cm.work.toUpperCase()}`, W - 24 * s, 40 * s); g.textAlign = 'left';
  g.fillStyle = '#1c1d20'; g.font = `${17 * s}px ${F.serif}`; const y = wrap(g, cm.s, 24 * s, 98 * s, W - 48 * s, 26 * s, 5);
  g.fillStyle = '#5a5d64'; g.font = `${13 * s}px ${F.mono}`; g.fillText(`${cm.n} page${cm.n === 1 ? '' : 's'} touched`, 24 * s, Math.min(H - 20 * s, y + 18 * s));
  return c;
}

// ------------------------------------------------------------------ the stage
export function createStudio(host, hooks = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping; renderer.toneMappingExposure = 1.3; // product-photo neutral: paper stays paper-white
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.domElement.className = 'studio-gl';
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0c0c0c);
  scene.fog = new THREE.Fog(0x0c0c0c, 60, 240); // only the far sweep fades; re-scaled per scene
  // a photographer's studio, built as light: one large key softbox, two strip lights, an overhead scrim, a low fill card.
  // Every reflection on metal, glass and paper is one of these panels.
  function softboxStudio() {
    const st = new THREE.Scene();
    st.add(new THREE.Mesh(new THREE.BoxGeometry(90, 80, 90), new THREE.MeshBasicMaterial({ color: 0x0b0b0b, side: THREE.BackSide }))); // tall enough that the scrim hangs inside it
    const panel = (w, h, k, pos, look = [0, 2, 0]) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.985, 0.965).multiplyScalar(k), side: THREE.DoubleSide })); m.position.set(...pos); m.lookAt(...look); st.add(m); };
    panel(18, 12, 14, [-18, 18, 12]);       // key softbox, high camera-left
    panel(2.6, 26, 9, [22, 9, -6]);         // strip, right rear
    panel(2.6, 26, 6, [-22, 9, -16]);       // strip, left rear
    panel(30, 30, 3.2, [0, 32, 0], [0, 0, 0]); // overhead scrim: what flat metal tops reflect
    panel(16, 6, 1.4, [12, 3, 20]);         // fill card, low front right
    panel(70, 18, 0.55, [0, 16, -40]);       // back flat: a flat top seen from the front mirrors this, so metal reads as metal, not a hole
    panel(60, 14, 1.1, [0, 10, 40]);        // front bounce behind the camera, for faces turned toward the lens
    return st;
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(softboxStudio(), 0.012).texture;
  scene.environmentIntensity = 1.0;

  const camera = new THREE.PerspectiveCamera(28, 1, 0.03, 600); // a long lens: little distortion, product-shot compression
  camera.position.set(0, 14, 26);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.075;
  controls.zoomToCursor = true; controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI * 0.485; controls.minDistance = 0.5; controls.maxDistance = 140;
  controls.rotateSpeed = 0.5; controls.zoomSpeed = 1.1; controls.panSpeed = 0.8;

  // the key's shadow comes from the softbox's direction; VSM gives it a softbox-wide penumbra
  const key = new THREE.DirectionalLight(0xfffaf2, 2.1); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.015; key.shadow.radius = 14; key.shadow.blurSamples = 20;
  scene.add(key, key.target);

  // an infinity cove: floor that sweeps up into the wall, so there is no horizon line anywhere you orbit
  const coveMat = new THREE.MeshPhysicalMaterial({ color: 0x232323, roughness: 0.86, side: THREE.DoubleSide }); // seamless paper sweep: matte, no pattern to betray the geometry
  const coveProfile = [new THREE.Vector2(0, 0)];
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI / 2; coveProfile.push(new THREE.Vector2(1 + Math.sin(a) * 0.32, 0.32 - Math.cos(a) * 0.32)); }
  coveProfile.push(new THREE.Vector2(1.32, 1.1));
  const cove = new THREE.Mesh(new THREE.LatheGeometry(coveProfile, 180), coveMat);
  cove.receiveShadow = true; cove.scale.setScalar(60); scene.add(cove);

  // post: supersampled stills when the camera rests, ground-truth AO, attention-following focus, then lens and grain
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const livePass = new RenderPass(scene, camera);
  const stillPass = new TAARenderPass(scene, camera, 0x0c0c0c, 1); stillPass.sampleLevel = 1; stillPass.accumulate = true; stillPass.enabled = false;
  composer.addPass(livePass); composer.addPass(stillPass);
  const gtao = new GTAOPass(scene, camera, 512, 512);
  gtao.updateGtaoMaterial({ radius: 0.45, distanceExponent: 1.6, thickness: 1.2, scale: 1.15, samples: 16, distanceFallOff: 1, screenSpaceRadius: false });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
  gtao.blendIntensity = 1;
  composer.addPass(gtao);
  const bokeh = new BokehPass(scene, camera, { focus: 20, aperture: 0.00005, maxblur: 0.004 });
  composer.addPass(bokeh);
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.45, 0.4, 1.6); // HDR threshold: only the pulses bloom
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const film = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.016 }, res: { value: new THREE.Vector2(1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform vec2 res; varying vec2 vUv;
      float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        vec2 d = vUv - 0.5; float r = dot(d, d);
        float ca = 0.0012 * r;
        vec3 c = vec3(texture2D(tDiffuse, vUv - d * ca).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + d * ca).b);
        c *= mix(0.78, 1.0, smoothstep(0.7, 0.1, r * 1.6)); // natural lens falloff
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c += (rand(floor(vUv * res) + fract(time)) - 0.5) * grain * (1.0 - l * 0.6); // grain lives in the shadows, like film
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  composer.addPass(film);
  const hud = document.createElement('div'); hud.className = 'studio-hud'; host.appendChild(hud);

  // ---------------------------------------------------------------- materials
  const brushN = surfaceTex(SURF.brushN, 3), brushR = surfaceTex(SURF.brushR, 3), paperN = surfaceTex(SURF.paperN, 4);
  const M = {
    alu: new THREE.MeshPhysicalMaterial({ color: 0xc8c8c8, metalness: 1, roughness: 0.42, roughnessMap: brushR, normalMap: brushN, normalScale: new THREE.Vector2(0.18, 0.18), anisotropy: 0.85, clearcoat: 0.15, clearcoatRoughness: 0.35 }),
    titanium: new THREE.MeshPhysicalMaterial({ color: 0x8c8a86, metalness: 1, roughness: 0.26, roughnessMap: brushR, normalMap: brushN, normalScale: new THREE.Vector2(0.08, 0.08), anisotropy: 0.6 }),
    graphite: new THREE.MeshPhysicalMaterial({ color: 0x1e1e1e, metalness: 0.9, roughness: 0.4, normalMap: brushN, normalScale: new THREE.Vector2(0.06, 0.06), clearcoat: 0.35, clearcoatRoughness: 0.3 }),
    anodised: new THREE.MeshPhysicalMaterial({ color: 0x4a4a4a, metalness: 0.85, roughness: 0.3, normalMap: brushN, normalScale: new THREE.Vector2(0.1, 0.1), clearcoat: 0.55, clearcoatRoughness: 0.18 }),
    frosted: new THREE.MeshPhysicalMaterial({ color: 0x151515, metalness: 0, roughness: 0.55, clearcoat: 0.8, clearcoatRoughness: 0.45 }),
    bezel: new THREE.MeshPhysicalMaterial({ color: 0x020202, metalness: 0, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.03 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0x050608, metalness: 0.2, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0.35, iridescenceIOR: 1.4 }),
    acrylic: new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.16, clearcoat: 1, clearcoatRoughness: 0.02, depthWrite: false }),
    paperBack: new THREE.MeshPhysicalMaterial({ color: 0xe6e5e0, roughness: 0.92, normalMap: paperN, normalScale: new THREE.Vector2(0.08, 0.08), sheen: 0.35, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff) }),
    paperEdge: new THREE.MeshPhysicalMaterial({ color: 0xdcdbd5, roughness: 0.94, sheen: 0.25, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff) }),
    cable: new THREE.MeshPhysicalMaterial({ color: 0x0d0d0d, roughness: 0.5, metalness: 0, sheen: 0.5, sheenRoughness: 0.5, sheenColor: new THREE.Color(0x555555), clearcoat: 0.35, clearcoatRoughness: 0.4 }),
    cableLit: new THREE.MeshPhysicalMaterial({ color: 0x262626, roughness: 0.38, metalness: 0.1, clearcoat: 0.6 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x000000, metalness: 0, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.08, depthWrite: false, envMapIntensity: 0.6 }),
    pulse: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(4), toneMapped: false }),
    receipt: new THREE.MeshPhysicalMaterial({ color: 0xeeede7, roughness: 0.8, sheen: 0.3, sheenColor: new THREE.Color(0xffffff) }),
  };

  // ---------------------------------------------------------------- object factories
  const world = new THREE.Group(); scene.add(world);
  let items = [], pickables = [], cables = [], pulses = [], disposables = [];
  const own = x => { disposables.push(x); return x; };
  const item = (group, info) => { group.userData.item = { ...info, group, baseY: group.position.y, lift: 0 }; group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.userData.owner = group; pickables.push(o); } }); items.push(group.userData.item); world.add(group); return group.userData.item; };

  function paperSheet(canvas, w = 1.1) {
    const h = w * canvas.height / canvas.width, g = new THREE.Group();
    const geo = own(new THREE.PlaneGeometry(w, h, 10, 12)), pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i) / w, y = pos.getY(i) / h; pos.setZ(i, 0.018 * Math.sin((x + 0.5) * Math.PI) * 0.4 + 0.012 * Math.pow(Math.max(0, y - 0.3), 2)); }
    geo.computeVertexNormals();
    const map = own(tex(canvas, renderer));
    const front = new THREE.Mesh(geo, own(new THREE.MeshPhysicalMaterial({ map, roughness: 0.9, metalness: 0, normalMap: paperN, normalScale: new THREE.Vector2(0.07, 0.07), sheen: 0.3, sheenRoughness: 0.9, sheenColor: new THREE.Color(0xffffff) })));
    front.userData.isFront = true;
    const back = new THREE.Mesh(geo, M.paperBack); back.rotation.y = Math.PI; back.position.z = -0.0028;
    const edge = new THREE.Mesh(own(new THREE.BoxGeometry(w * 0.998, h * 0.998, 0.0026)), M.paperEdge); edge.position.z = -0.0014; // 90 gsm has a visible edge
    g.add(front, back, edge); g.userData.front = front; g.userData.size = [w, h];
    return g;
  }
  function documentOnStand(n, rel) {
    const g = new THREE.Group(), sheet = paperSheet(printPage(n, rel));
    g.userData.reprint = () => printPage(n, rel, 1100);
    const [w, h] = sheet.userData.size;
    sheet.position.set(0, h / 2 + 0.06, 0); sheet.rotation.x = -0.12;
    const stand = new THREE.Mesh(own(new THREE.BoxGeometry(w * 0.72, 0.05, 0.28)), M.acrylic); stand.position.set(0, 0.025, 0.02);
    const lip = new THREE.Mesh(own(new THREE.BoxGeometry(w * 0.72, 0.1, 0.02)), M.acrylic); lip.position.set(0, 0.07, 0.12);
    g.add(sheet, stand, lip); g.userData.sheet = sheet; g.userData.height = h + 0.1;
    return g;
  }
  function plinth(n, count) {
    const g = new THREE.Group(), w = 2.6 + Math.min(1.6, count * 0.05), h = 0.62;
    const body = new THREE.Mesh(own(new RoundedBoxGeometry(w, h, w, 5, 0.06)), M.alu); body.position.y = h / 2;
    const plate = new THREE.Mesh(own(new THREE.PlaneGeometry(w * 0.86, w * 0.34)), own(new THREE.MeshStandardMaterial({ map: own(tex(printEngraving(n.t, 1024, 400, { size: 0.2 }), renderer)), transparent: true, roughness: 0.5, metalness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })));
    plate.rotation.x = -Math.PI / 2; plate.position.y = h + 0.002;
    g.add(body, plate); g.userData.height = h;
    return g;
  }
  function token(n, r = 0.3) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(own(new THREE.CylinderGeometry(r, r, 0.07, 64)), M.anodised); body.position.y = 0.035;
    const top = new THREE.Mesh(own(new THREE.CircleGeometry(r * 0.92, 48)), own(new THREE.MeshStandardMaterial({ map: own(tex(printEngraving(n.t.replace(/\s+/g, ' ').split(' ').reduce((a, w) => { const last = a[a.length - 1]; if (last && (last + ' ' + w).length < 14) a[a.length - 1] = last + ' ' + w; else a.push(w); return a; }, []).slice(0, 3).join('\n'), 512, 512, { fg: 'rgba(235,235,235,0.9)', size: 0.12, tracking: 2 }), renderer)), transparent: true, roughness: 0.45, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -2 })));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.0705;
    g.add(body, top); g.userData.height = 0.07;
    return g;
  }
  function roundedRect(w, h, r) {
    const sh = new THREE.Shape(), x = -w / 2, y = -h / 2;
    sh.moveTo(x + r, y); sh.lineTo(x + w - r, y); sh.quadraticCurveTo(x + w, y, x + w, y + r); sh.lineTo(x + w, y + h - r); sh.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    sh.lineTo(x + r, y + h); sh.quadraticCurveTo(x, y + h, x, y + h - r); sh.lineTo(x, y + r); sh.quadraticCurveTo(x, y, x + r, y);
    const geo = new THREE.ShapeGeometry(sh, 16), pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) - x) / w, (pos.getY(i) - y) / h);
    return geo;
  }
  /** A phone: titanium band, black glass front with an island, frosted back with a lens plateau, and a live screen. */
  function phone(node, T) {
    const g = new THREE.Group(), w = 0.74, h = 1.52, d = 0.078;
    const band = new THREE.Mesh(own(new RoundedBoxGeometry(w, h, d, 8, 0.11)), M.titanium);
    const front = new THREE.Mesh(own(roundedRect(w - 0.012, h - 0.012, 0.1)), M.bezel); front.position.z = d / 2 + 0.0008;
    const sw = w - 0.052, sh = h - 0.052;
    const W = 780, H = Math.round(W * sh / sw);
    const state = { stack: [node.id], pressed: -1, pressedUntil: 0, toast: null, toastUntil: 0, parentLabel: '' };
    const map = own(new THREE.CanvasTexture(document.createElement('canvas'))); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const screenMesh = new THREE.Mesh(own(roundedRect(sw, sh, 0.085)), own(new THREE.MeshBasicMaterial({ map, color: 0xe4e4e4 })));
    screenMesh.position.z = d / 2 + 0.0014; screenMesh.userData.isScreen = true;
    const island = new THREE.Mesh(own(new RoundedBoxGeometry(0.2, 0.058, 0.002, 2, 0.028)), M.bezel); island.position.set(0, sh / 2 - 0.055, d / 2 + 0.0024);
    const cover = new THREE.Mesh(own(roundedRect(w - 0.012, h - 0.012, 0.1)), M.glass); cover.position.z = d / 2 + 0.003;
    const back = new THREE.Mesh(own(roundedRect(w - 0.012, h - 0.012, 0.1)), M.frosted); back.position.z = -d / 2 - 0.0008; back.rotation.y = Math.PI;
    const plateau = new THREE.Mesh(own(new RoundedBoxGeometry(0.3, 0.3, 0.012, 4, 0.05)), M.frosted); plateau.position.set(w / 2 - 0.2, h / 2 - 0.2, -d / 2 - 0.006);
    const lenses = [[-0.06, 0.06], [-0.06, -0.06], [0.07, 0]].map(([lx, ly]) => { const l = new THREE.Mesh(own(new THREE.CylinderGeometry(0.045, 0.047, 0.016, 48)), M.lens); l.rotation.x = Math.PI / 2; l.position.set(w / 2 - 0.2 + lx, h / 2 - 0.2 + ly, -d / 2 - 0.016); return l; });
    const btn = (y, len, side) => { const b = new THREE.Mesh(own(new RoundedBoxGeometry(0.008, len, 0.024, 2, 0.004)), M.titanium); b.position.set(side * (w / 2 + 0.002), y, 0); return b; };
    const body = new THREE.Group(); body.add(band, front, screenMesh, island, cover, back, plateau, ...lenses, btn(0.34, 0.09, -1), btn(0.2, 0.14, -1), btn(0.03, 0.14, -1), btn(0.24, 0.2, 1));
    body.position.y = h / 2 + 0.04; body.rotation.x = -0.14;
    const foot = new THREE.Mesh(own(new RoundedBoxGeometry(w * 0.62, 0.035, 0.34, 3, 0.015)), M.alu); foot.position.set(0, 0.018, -0.07);
    g.add(body, foot); g.userData.sheet = body; g.userData.height = h + 0.08; g.userData.size = [w, h];
    const byId = new Map(T.nodes.map(n => [n.id, n])), out = id => T.edges.filter(e => e.a === id).map(e => byId.get(e.b)).filter(Boolean);
    const screenOf = id => {
      const n = byId.get(id), kids = out(id);
      const views = kids.filter(k => /^slice:/.test(k.id));
      const own = (n.controls || []).length ? n.controls : views.flatMap(v => v.controls || []); // a route shows its view's controls
      return {
        kind: n.kind, title: n.label, sub: n.redirect ? `redirects to ${n.redirect}` : n.files?.[0],
        controls: own.filter(b => b.label && !b.label.startsWith('key:')).slice(0, 12), controlCount: own.length,
        opens: views.map(v => ({ id: v.id, kind: v.kind, label: v.label, meta: `${v.controlCount || 0} controls · ${v.files.length} files` })),
        talks: kids.filter(k => !/^slice:|^route:/.test(k.id)).map(k => ({ id: k.id, kind: k.kind, label: k.label, meta: KIND[k.kind] || k.kind })),
      };
    };
    const redraw = () => {
      const cur = state.stack[state.stack.length - 1];
      state.parentLabel = state.stack.length > 1 ? byId.get(state.stack[state.stack.length - 2]).label : '';
      state.screen = screenOf(cur);
      const r = printPhone(state.screen, W, H, state);
      state.hits = r.hits; map.image = r.canvas; map.needsUpdate = true; dirty = true;
    };
    const tap = (u, v) => {
      const px = u * W, py = (1 - v) * H, hit = (state.hits || []).find(h => px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h);
      if (!hit) return null;
      if (hit.act === 'back') state.stack.pop();
      else if (hit.act === 'open') state.stack.push(hit.id);
      else if (hit.act === 'press') {
        const b = state.screen.controls[hit.index];
        state.pressed = hit.index; state.pressedUntil = performance.now() + 260;
        state.toast = { title: b.handler ? `onClick → ${b.handler}()` : 'No click handler in the source', where: `${b.file.split('/').pop()}:${b.line}` };
        state.toastUntil = performance.now() + 2600;
        setTimeout(redraw, 280); setTimeout(redraw, 2650);
      }
      redraw();
      return hit;
    };
    g.userData.phone = { redraw, tap, state };
    redraw();
    return g;
  }
  function paperStack(n, files) {
    const g = new THREE.Group(), count = Math.max(1, Math.min(18, files)), w = 0.9, dd = 1.16;
    for (let i = 0; i < count - 1; i++) { const s = new THREE.Mesh(own(new THREE.BoxGeometry(w, 0.012, dd)), M.paperEdge); s.position.set((Math.sin(i * 12.9) * 0.02), 0.006 + i * 0.012, Math.cos(i * 7.3) * 0.02); s.rotation.y = Math.sin(i * 3.1) * 0.03; g.add(s); }
    const top = paperSheet(printPage({ s: n.id, k: n.kind, t: n.label, desc: `${n.controlCount || 0} controls in ${n.files.length} file${n.files.length === 1 ? '' : 's'}.`, file: n.files[0] }, { deps: [], holds: [] }), w);
    top.rotation.x = -Math.PI / 2; top.position.y = 0.012 * (count - 1) + 0.008;
    g.add(top); g.userData.height = 0.012 * count;
    return g;
  }
  function milledKey(n, dark) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(own(new RoundedBoxGeometry(0.9, 0.16, 0.34, 4, 0.03)), dark ? M.graphite : M.alu); body.position.y = 0.08;
    const face = new THREE.Mesh(own(new THREE.PlaneGeometry(0.84, 0.3)), own(new THREE.MeshStandardMaterial({ map: own(tex(printEngraving(n.label, 768, 256, { fg: dark ? 'rgba(230,230,230,0.85)' : 'rgba(25,25,25,0.8)', size: 0.24 }), renderer)), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 })));
    face.rotation.x = -Math.PI / 2; face.position.y = 0.161;
    g.add(body, face); g.userData.height = 0.16;
    return g;
  }
  function receiptRoll(n) {
    const g = new THREE.Group();
    const roll = new THREE.Mesh(own(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 48)), M.receipt); roll.rotation.z = Math.PI / 2; roll.position.y = 0.2;
    const core = new THREE.Mesh(own(new THREE.CylinderGeometry(0.06, 0.06, 0.505, 24)), M.graphite); core.rotation.z = Math.PI / 2; core.position.y = 0.2;
    const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d'); grainFill(x, 256, 512, '#f1f0ea', 5);
    x.fillStyle = '#2a2a2a'; x.font = `500 18px ${F.mono}`; x.fillText(n.label, 16, 40);
    x.font = `13px ${F.mono}`; x.fillStyle = '#6a6a6a'; for (let i = 0; i < 14; i++) x.fillText(`{"at":"…","event":"…"}`, 16, 80 + i * 28);
    const strip = new THREE.Mesh(own(new THREE.PlaneGeometry(0.46, 0.9)), own(new THREE.MeshStandardMaterial({ map: own(tex(c, renderer)), roughness: 0.85, side: THREE.DoubleSide })));
    strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.004, 0.62);
    g.add(roll, core, strip); g.userData.height = 0.4;
    return g;
  }
  function indexCard(cm) {
    const g = new THREE.Group(), sheet = paperSheet(printCard(cm), 1.5);
    g.userData.reprint = () => printCard(cm, 1400);
    sheet.position.y = sheet.userData.size[1] / 2 + 0.02;
    g.add(sheet); g.userData.sheet = sheet; g.userData.height = sheet.userData.size[1];
    return g;
  }

  // cables lie on the floor between two objects and carry pulses
  function cable(a, b, lit = false) {
    const A = a.group.position, B = b.group.position, dir = new THREE.Vector3().subVectors(B, A); dir.y = 0;
    const len = dir.length(); if (len < 0.2) return null; dir.normalize();
    const perp = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(len * 0.12 * (((a.key + b.key).length % 2) ? 1 : -1));
    const y = 0.022, off = 0.45;
    const pts = [new THREE.Vector3(A.x + dir.x * off, y, A.z + dir.z * off), new THREE.Vector3().lerpVectors(A, B, 0.3).add(perp).setY(y), new THREE.Vector3().lerpVectors(A, B, 0.7).add(perp).setY(y), new THREE.Vector3(B.x - dir.x * off, y, B.z - dir.z * off)];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const mesh = new THREE.Mesh(own(new THREE.TubeGeometry(curve, Math.max(24, Math.round(len * 10)), 0.02, 8, false)), lit ? M.cableLit : M.cable);
    mesh.castShadow = true; mesh.receiveShadow = true; world.add(mesh);
    const c = { a, b, curve, mesh }; cables.push(c); return c;
  }
  function sendPulse(c, delay = 0, reverse = false) {
    const s = new THREE.Mesh(own(new THREE.SphereGeometry(0.045, 16, 12)), M.pulse); s.visible = false; world.add(s);
    const glow = new THREE.PointLight(0xffffff, 0, 1.4, 2); s.add(glow);
    pulses.push({ c, s, glow, t0: performance.now() + delay, dur: 1100 + c.curve.getLength() * 90, reverse });
  }

  // ---------------------------------------------------------------- layouts
  function clear() {
    st = null; nowClip.constant = 1e6;
    for (const o of [...world.children]) world.remove(o);
    for (const d of disposables) d.dispose?.();
    items = []; pickables = []; cables = []; pulses = []; disposables = []; selected = null; hovered = null; held = null; hideInspector();
  }
  function layoutVault(G) {
    const nodes = G.nodes.map(n => ({ ...n })), by = new Map(nodes.map(n => [n.s, n]));
    const inc = new Map(nodes.map(n => [n.s, []])); for (const e of G.edges) { inc.get(e.a).push(e); inc.get(e.b).push(e); }
    const domOf = n => n.k === 'domain' ? n : (inc.get(n.s).filter(e => e.y === 'c' && e.b === n.s).map(e => by.get(e.a)).find(x => x.k === 'domain') || inc.get(n.s).filter(e => e.y === 'c' && e.b === n.s).map(e => by.get(e.a)).map(domOf).find(Boolean) || null);
    const doms = nodes.filter(n => n.k === 'domain');
    doms.forEach((d, i) => { const a = (i / Math.max(1, doms.length)) * Math.PI * 2; d.ax = Math.cos(a) * (doms.length > 1 ? 360 : 0); d.ay = Math.sin(a) * (doms.length > 1 ? 300 : 0); });
    const anchor = n => { const d = domOf(n); return d ? { x: d.ax, y: d.ay } : { x: 0, y: 0 }; };
    window.d3.forceSimulation(nodes)
      .force('link', window.d3.forceLink(G.edges.map(e => ({ source: by.get(e.a), target: by.get(e.b), y: e.y }))).distance(l => l.y === 'c' ? (l.source.k === 'domain' ? 150 : 60) : 140).strength(l => l.y === 'c' ? 0.5 : 0.04))
      .force('charge', window.d3.forceManyBody().strength(n => n.k === 'domain' ? -1400 : n.k === 'capability' ? -320 : -90).distanceMax(500))
      .force('collide', window.d3.forceCollide(n => n.k === 'domain' ? 90 : n.k === 'capability' ? 44 : 22).iterations(3))
      .force('x', window.d3.forceX(n => anchor(n).x).strength(n => n.k === 'domain' ? 0.6 : 0.07))
      .force('y', window.d3.forceY(n => anchor(n).y).strength(n => n.k === 'domain' ? 0.6 : 0.07))
      .stop().tick(420);
    const S = 0.028, placed = new Map();
    for (const n of nodes) {
      const rel = { domain: domOf(n) && domOf(n) !== n ? domOf(n).t : null, deps: inc.get(n.s).filter(e => e.y === 'd' && e.a === n.s).map(e => by.get(e.b).t).slice(0, 5), holds: inc.get(n.s).filter(e => e.y === 'c' && e.a === n.s).map(e => by.get(e.b).t).slice(0, 5) };
      const g = n.k === 'domain' ? plinth(n, inc.get(n.s).length) : n.k === 'element' ? token(n) : documentOnStand(n, rel);
      g.position.set(n.x * S, 0, n.y * S);
      const d = domOf(n);
      if (n.k !== 'domain' && n.k !== 'element') { const dx = n.x - (d ? d.x : 0), dy = n.y - (d ? d.y : 0); g.rotation.y = Math.atan2(dx, dy); }
      else if (n.k === 'element') g.rotation.y = (n.s.length * 0.7) % (Math.PI * 2);
      const it = item(g, { key: n.s, kind: n.k, title: n.t, desc: n.desc, ko: n.ko, path: n.p, uid: n.uid, rel, node: n, file: n.file });
      placed.set(n.s, it);
    }
    for (const e of G.edges) if (e.y === 'd' || e.y === 'r') { const c = cable(placed.get(e.a), placed.get(e.b)); if (c) c.kind = e.y; }
    for (const it of items) it.links = G.edges.filter(e => e.a === it.key || e.b === it.key).map(e => ({ y: e.y, other: placed.get(e.a === it.key ? e.b : e.a), dir: e.a === it.key ? 'out' : 'in' }));
  }
  function layoutTrace(T, _spec) {
    const rows = [['route'], ['view'], ['widget'], ['feature'], ['entity'], ['intent', 'prompt'], ['desktop', 'jsonl'], ['mcp'], ['meaning'], ['decision']];
    const placed = new Map();
    rows.forEach((kinds, r) => {
      const list = T.nodes.filter(n => kinds.includes(n.kind)).sort((a, b) => a.label.localeCompare(b.label));
      const gap = r === 0 ? 1.05 : r === 7 || r === 8 ? 1.15 : 1.3, perRow = r === 0 ? 22 : 24;
      list.forEach((n, i) => {
        const line = Math.floor(i / perRow), col = i % perRow, cols = Math.min(perRow, list.length - line * perRow);
        const x = (col - (cols - 1) / 2) * gap, z = 7 - r * 3.2 - line * 1.6;
        const g = n.kind === 'route' ? phone(n, T) : ['view', 'widget', 'feature', 'entity'].includes(n.kind) ? paperStack(n, n.files.length)
          : n.kind === 'mcp' ? milledKey(n, false) : n.kind === 'desktop' ? milledKey(n, true) : n.kind === 'jsonl' ? receiptRoll(n)
          : documentOnStand({ s: n.id, k: n.kind, t: n.label, desc: n.kind === 'decision' ? `Recorded ${n.date}.` : n.kind === 'intent' || n.kind === 'prompt' ? `A ${n.kind} module the UI imports.` : '', file: n.files[0] }, { deps: [], holds: [] });
        g.position.set(x, 0, z);
        placed.set(n.id, item(g, { key: n.id, kind: n.kind, title: n.label, desc: n.redirect ? `Redirects to ${n.redirect}.` : n.controlCount ? `${n.controlCount} controls in ${n.files.length} files.` : n.date || '', path: n.files[0], trace: n }));
      });
    });
    for (const it of items) it.links = T.edges.filter(e => e.a === it.key || e.b === it.key).map(e => ({ y: 'd', other: placed.get(e.a === it.key ? e.b : e.a), dir: e.a === it.key ? 'out' : 'in' })).filter(l => l.other);
    return placed;
  }
  function layoutHistory(H) {
    const n = H.commits.length;
    H.commits.forEach((cm, i) => {
      const g = indexCard(cm);
      g.position.set(0, 0, (i - (n - 1)) * 0.22 + 3); // newest at the front of the tray
      g.rotation.x = -0.05;
      item(g, { key: `commit:${cm.h}`, kind: 'commit', title: cm.s, desc: `${cm.d.slice(0, 10)} · ${cm.work} · ${cm.n} page${cm.n === 1 ? '' : 's'}`, path: cm.h, commit: cm, index: i });
    });
    const tray = new THREE.Mesh(own(new RoundedBoxGeometry(1.8, 0.22, n * 0.22 + 0.6, 4, 0.04)), M.alu); tray.position.set(0, 0.03, 3 - (n - 1) * 0.11); tray.receiveShadow = true; tray.castShadow = true;
    const inner = new THREE.Mesh(own(new THREE.BoxGeometry(1.62, 0.2, n * 0.22 + 0.42)), M.graphite); inner.position.copy(tray.position).setY(0.05);
    world.add(tray, inner);
  }

  // ---------------------------------------------------------------- spacetime: the map lies flat, time rises
  // Each concept is a worldline standing on its map position. Every commit that changed it is a bead
  // on that line at the commit's moment: porcelain for a page change, dark metal for a code change.
  // A commit that touched several concepts ties their beads with a thin thread across the slice of
  // time, and a glass plane marks "now": everything above it has not happened yet and is cut away.
  const nowClip = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e6);
  renderer.localClippingEnabled = true;
  let st = null;
  function layoutSpacetime(S) {
    const H = 16, span = 30, clip = [nowClip];
    const xs = S.nodes.map(n => n.x), zs = S.nodes.map(n => n.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const k = span / Math.max(x1 - x0, z1 - z0, 1);
    const pos = new Map(S.nodes.map(n => [n.s, new THREE.Vector3((n.x - (x0 + x1) / 2) * k, 0, (n.z - (z0 + z1) / 2) * k)]));
    const yOf = t => 0.25 + ((t - S.t0) / Math.max(1, S.t1 - S.t0)) * H;
    const lineMat = own(new THREE.MeshPhysicalMaterial({ color: 0xa9a9a9, metalness: 0.85, roughness: 0.32, clippingPlanes: clip }));
    const domMat = own(new THREE.MeshPhysicalMaterial({ color: 0xd9d9d9, metalness: 0.9, roughness: 0.22, clearcoat: 0.4, clippingPlanes: clip }));
    const pageMat = own(new THREE.MeshPhysicalMaterial({ color: 0xf1f0eb, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0xffffff), clearcoat: 0.3, clippingPlanes: clip }));
    const codeMat = own(new THREE.MeshPhysicalMaterial({ color: 0x1e1e1e, metalness: 0.9, roughness: 0.28, clearcoat: 0.6, clippingPlanes: clip }));
    const threadMat = own(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, clippingPlanes: clip }));
    const reachMat = own(new THREE.LineDashedMaterial({ color: 0xbdbdbd, transparent: true, opacity: 0.2, dashSize: 0.12, gapSize: 0.1, clippingPlanes: clip }));
    // worldlines: one pickable column per concept, a token at its foot
    for (const n of S.nodes) {
      const p = pos.get(n.s), r = n.k === 'domain' ? 0.075 : n.k === 'capability' ? 0.042 : 0.026;
      const g = new THREE.Group(); g.position.copy(p);
      const col = new THREE.Mesh(own(new THREE.CylinderGeometry(r, r, H + 0.3, n.k === 'domain' ? 24 : 12)), n.k === 'domain' ? domMat : lineMat);
      col.position.y = (H + 0.3) / 2;
      const foot = new THREE.Mesh(own(new THREE.CylinderGeometry(r * 3.2, r * 3.6, 0.05, 32)), n.k === 'domain' ? M.anodised : M.graphite);
      foot.position.y = 0.025;
      g.add(col, foot);
      if (n.k === 'domain') {
        const tag = new THREE.Mesh(own(new THREE.PlaneGeometry(2.4, 0.5)), own(new THREE.MeshStandardMaterial({ map: own(tex(printEngraving(n.t.toUpperCase(), 1024, 214, { fg: 'rgba(235,235,235,0.9)', size: 0.3 }), renderer)), transparent: true, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2 })));
        tag.rotation.x = -Math.PI / 2; tag.position.set(0, 0.052, 0.55); g.add(tag);
      }
      g.userData.height = H;
      item(g, { key: n.s, kind: n.k, title: n.t, desc: `${n.events} change${n.events === 1 ? '' : 's'} on this worldline · ${n.pageEvents} to the page, ${n.codeEvents} to the code`, node: n });
    }
    // beads, instanced: one draw call per material however long the history
    const pageBeads = [], codeBeads = [], thread = [], reach = [];
    for (const e of S.events) {
      const y = yOf(e.t), touched = [...new Set([...e.n, ...e.code])].filter(s => pos.has(s));
      for (const s of e.n) if (pos.has(s)) pageBeads.push(pos.get(s).clone().setY(y));
      for (const s of e.code) if (pos.has(s) && !e.n.includes(s)) codeBeads.push(pos.get(s).clone().setY(y));
      if (touched.length > 1) {
        const c = touched.reduce((a, s) => a.add(pos.get(s)), new THREE.Vector3()).multiplyScalar(1 / touched.length).setY(y);
        for (const s of touched) thread.push(c.x, y, c.z, pos.get(s).x, y, pos.get(s).z);
      }
      for (const s of e.reach.slice(0, 8)) if (pos.has(s) && touched.length) { const a = pos.get(touched[0]), b = pos.get(s); reach.push(a.x, y, a.z, b.x, y + 0.18, b.z); }
    }
    const beads = (list, mat, r) => {
      if (!list.length) return;
      const m = new THREE.InstancedMesh(own(new THREE.SphereGeometry(r, 20, 14)), mat, list.length), o = new THREE.Object3D();
      list.forEach((v, i) => { o.position.copy(v); o.updateMatrix(); m.setMatrixAt(i, o.matrix); });
      m.castShadow = true; m.receiveShadow = true; world.add(m);
    };
    beads(pageBeads, pageMat, 0.085); beads(codeBeads, codeMat, 0.065);
    const lines = (arr, mat) => { if (!arr.length) return; const g = own(new THREE.BufferGeometry()); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); const l = new THREE.LineSegments(g, mat); if (mat.isLineDashedMaterial) l.computeLineDistances(); world.add(l); };
    lines(thread, threadMat); lines(reach, reachMat);
    // the time ruler: an anodised mast with a tag at each week
    const ruler = new THREE.Group(); ruler.position.set(-span / 2 - 1.6, 0, span / 2 + 1.6);
    const mast = new THREE.Mesh(own(new THREE.CylinderGeometry(0.05, 0.05, H + 0.5, 16)), M.alu); mast.position.y = (H + 0.5) / 2; ruler.add(mast);
    const DAY = 864e5, first = Math.ceil(S.t0 / (7 * DAY)) * 7 * DAY;
    for (let t = first; t <= S.t1; t += 7 * DAY) {
      const y = yOf(t), tick = new THREE.Mesh(own(new THREE.BoxGeometry(0.5, 0.02, 0.02)), M.alu); tick.position.set(0.25, y, 0); ruler.add(tick);
      const lab = new THREE.Mesh(own(new THREE.PlaneGeometry(1.5, 0.3)), own(new THREE.MeshBasicMaterial({ map: own(tex(printEngraving(new Date(t).toISOString().slice(0, 10), 600, 120, { fg: 'rgba(230,230,230,0.9)', size: 0.5 }), renderer)), transparent: true })));
      lab.position.set(1.35, y, 0); ruler.add(lab);
    }
    world.add(ruler);
    // "now": a sheet of glass across the whole block, framed in brushed metal
    const now = new THREE.Group(), w = span + 2.4;
    const glass = new THREE.Mesh(own(new THREE.BoxGeometry(w, 0.02, w)), own(new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.08, transmission: 0.9, thickness: 0.2, transparent: true, opacity: 0.18, depthWrite: false })));
    now.add(glass);
    for (const [sx, sz, lx, lz] of [[0, w / 2, w, 0.06], [0, -w / 2, w, 0.06], [w / 2, 0, 0.06, w], [-w / 2, 0, 0.06, w]]) { const f = new THREE.Mesh(own(new THREE.BoxGeometry(lx, 0.05, lz)), M.graphite); f.position.set(sx, 0, sz); now.add(f); }
    const nowLab = new THREE.Mesh(own(new THREE.PlaneGeometry(3.2, 0.42)), own(new THREE.MeshBasicMaterial({ transparent: true })));
    nowLab.position.set(-w / 2 + 1.7, 0.05, w / 2 + 0.3); nowLab.rotation.x = -Math.PI / 2; now.add(nowLab);
    world.add(now);
    st = { yOf, now, nowLab, H };
    setNow(S.t1);
  }
  function setNow(t) {
    if (!st) return;
    const y = st.yOf(t) + 0.02;
    st.now.position.y = y; nowClip.constant = y + 0.001;
    const c = printEngraving(`NOW ${new Date(t).toISOString().slice(0, 16).replace('T', ' ')}`, 900, 118, { fg: 'rgba(240,240,240,0.95)', size: 0.46 });
    st.nowLab.material.map?.dispose(); st.nowLab.material.map = tex(c, renderer); st.nowLab.material.needsUpdate = true;
    dirty = true;
  }

  // ---------------------------------------------------------------- camera work
  const tmp = new THREE.Vector3(), box = new THREE.Box3();
  let flight = null;
  function fitAll(ms = 1400, cut = false) {
    box.makeEmpty(); for (const it of items) box.expandByObject(it.group);
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = box.getBoundingSphere(new THREE.Sphere()).radius;
    const dist = r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.62;
    const dir = new THREE.Vector3(0.32, 0.46, 1).normalize();
    const shot = c.clone().add(dir.clone().multiplyScalar(dist));
    if (cut) { // a new scene opens on a hard cut, then a slow push-in: never a flight from the last set
      flight = null; controls.target.copy(c); camera.position.copy(c.clone().add(dir.clone().multiplyScalar(dist * 1.28)));
      controls.update();
    }
    fly(shot, c, ms);
    scene.fog.near = dist * 2.2; scene.fog.far = dist * 6;
    controls.maxDistance = dist * 3;
    cove.scale.setScalar(Math.max(12, r * 2.4)); cove.position.set(c.x, 0, c.z);
    key.shadow.camera.left = key.shadow.camera.bottom = -r * 1.15; key.shadow.camera.right = key.shadow.camera.top = r * 1.15; key.shadow.camera.far = r * 5 + 60; key.shadow.camera.updateProjectionMatrix();
    key.position.copy(c).add(new THREE.Vector3(-18, 18, 12).normalize().multiplyScalar(r * 2 + 12)); key.target.position.copy(c);
    gtao.updateGtaoMaterial({ radius: Math.max(0.25, Math.min(1.2, r * 0.035)) });
  }
  function fly(pos, target, ms = 1100) {
    if (REDUCED) { camera.position.copy(pos); controls.target.copy(target); return; }
    flight = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, start: performance.now(), ms };
  }
  const centreOf = it => { box.setFromObject(it.group); return box.getCenter(new THREE.Vector3()); };
  function focusOn(it, align = false) {
    const c = centreOf(it), size = box.getSize(new THREE.Vector3()).length();
    let dir;
    if (align && it.group.userData.sheet) { dir = new THREE.Vector3(0, 0, 1).applyQuaternion(it.group.userData.sheet.getWorldQuaternion(new THREE.Quaternion())); dir.y = Math.max(dir.y, 0.12); }
    else dir = camera.position.clone().sub(controls.target).normalize();
    const dist = Math.max(1.8, size * 1.9);
    fly(c.clone().add(dir.normalize().multiplyScalar(dist)), c);
  }
  // pick up: bring a sheet or phone to a reading pose in front of the lens
  let held = null;
  function pickUp(it) {
    if (!it.group.userData.sheet) { focusOn(it, true); return; }
    putDown();
    const obj = it.group.userData.sheet;
    held = { it, obj, parent: obj.parent, pos: obj.position.clone(), quat: obj.quaternion.clone(), start: performance.now(), mode: 'up' };
    const wp = obj.getWorldPosition(new THREE.Vector3()), wq = obj.getWorldQuaternion(new THREE.Quaternion());
    scene.attach(obj); obj.position.copy(wp); obj.quaternion.copy(wq);
    held.fromP = wp; held.fromQ = wq;
    const re = it.group.userData.reprint;
    if (re && !it.hires) { // swap in a reading-resolution print the first time a page is picked up
      const face = []; obj.traverse(o => { if (o.isMesh && o.userData.isFront) face.push(o); });
      const map = own(tex(re(), renderer));
      for (const m of face) { m.material.map = map; if (m.material.emissiveMap) m.material.emissiveMap = map; m.material.needsUpdate = true; }
      it.hires = true;
    }
    controls.enabled = false;
    showInspector(it, true);
  }
  function putDown() {
    if (!held) return;
    held.parent.attach(held.obj); held.obj.position.copy(held.pos); held.obj.quaternion.copy(held.quat);
    held = null; controls.enabled = true;
  }
  function holdPose() {
    const size = held.obj === held.it.group.userData.sheet && held.it.group.userData.size ? held.it.group.userData.size : [1.1, 1.42];
    const vh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)), dist = (size[1] * 1.18) / vh;
    const p = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(dist));
    const q = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.04, -0.06, 0.012)));
    return { p, q, dist };
  }

  // ---------------------------------------------------------------- interaction
  const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
  let hovered = null, selected = null, downAt = null, _lastInput = performance.now();
  let lastHit = null;
  const hit = ev => {
    const r = renderer.domElement.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const pool = held ? [] : pickables;
    if (held) held.obj.traverse(o => { if (o.isMesh) pool.push(o); });
    const h = ray.intersectObjects(pool, false)[0];
    lastHit = h || null;
    return h ? (h.object.userData.owner || held?.it.group).userData.item : null;
  };
  const el = renderer.domElement;
  el.addEventListener('pointermove', ev => { _lastInput = performance.now(); controls.autoRotate = false; if (held) return; hovered = hit(ev); el.style.cursor = hovered ? 'pointer' : 'grab'; hooks.onHover?.(hovered, ev); });
  el.addEventListener('pointerdown', ev => { downAt = { x: ev.clientX, y: ev.clientY, t: performance.now() }; _lastInput = performance.now(); });
  el.addEventListener('pointerup', ev => {
    if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 4) return;
    const it = hit(ev);
    // a tap on a phone's screen is a tap in the app: press a control, open a module, go back
    if (it && lastHit?.object.userData.isScreen && lastHit.uv && it.group.userData.phone) {
      if (!held && selected !== it) { select(it); focusOn(it, true); return; }
      it.group.userData.phone.tap(lastHit.uv.x, lastHit.uv.y); return;
    }
    if (held) { putDown(); return; }
    if (it) { select(it); focusOn(it); } else { selected = null; hideInspector(); }
  });
  el.addEventListener('dblclick', ev => { const it = hit(ev); if (it) { select(it); pickUp(it); } });
  // infinite zoom: when the lens reaches the orbit point, keep travelling and carry the orbit point with it
  el.addEventListener('wheel', ev => {
    _lastInput = performance.now(); controls.autoRotate = false; flight = null;
    const dist = camera.position.distanceTo(controls.target);
    if (ev.deltaY < 0 && dist < controls.minDistance * 2.2) {
      const step = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(Math.min(1.5, Math.abs(ev.deltaY) * 0.004 + 0.05));
      camera.position.add(step); controls.target.add(step);
    }
  }, { passive: true });
  // aligned framings: 1 front, 2 plan (straight down, grid-aligned), 3 three-quarter; Shift+release snaps the orbit to 45°
  function preset(k) {
    const c = controls.target.clone(), dist = camera.position.distanceTo(c);
    const dir = k === '1' ? new THREE.Vector3(0, 0.12, 1) : k === '2' ? new THREE.Vector3(0, 1, 0.0001) : new THREE.Vector3(0.7, 0.55, 0.7);
    fly(c.clone().add(dir.normalize().multiplyScalar(dist)), c, 900);
  }
  let shiftDown = false;
  addEventListener('keyup', ev => { if (ev.key === 'Shift') shiftDown = false; });
  addEventListener('keydown', ev => { if (ev.key === 'Shift') shiftDown = true; });
  controls.addEventListener('end', () => {
    if (!shiftDown) return;
    const off = camera.position.clone().sub(controls.target), sph = new THREE.Spherical().setFromVector3(off);
    sph.theta = Math.round(sph.theta / (Math.PI / 4)) * (Math.PI / 4); sph.phi = Math.max(0.05, Math.round(sph.phi / (Math.PI / 12)) * (Math.PI / 12));
    fly(controls.target.clone().add(new THREE.Vector3().setFromSpherical(sph)), controls.target.clone(), 500);
  });
  function onKey(ev) {
    if (!visible || ev.target.closest('input, textarea, select') || ev.metaKey || ev.ctrlKey) return;
    const k = ev.key.toLowerCase();
    if (k === 'escape') { if (held) putDown(); else if (selected) { selected = null; hideInspector(); } else return; ev.stopPropagation(); }
    else if (k === 'r') fitAll();
    else if (k === '1' || k === '2' || k === '3') preset(k);
    else if (k === 'w' || k === 's') { const step = camera.getWorldDirection(new THREE.Vector3()).multiplyScalar((k === 'w' ? 1 : -1) * Math.max(0.25, camera.position.distanceTo(controls.target) * 0.12)); camera.position.add(step); controls.target.add(step); flight = null; }
    else if (!selected) return;
    else if (k === 'f') focusOn(selected);
    else if (k === 'a') focusOn(selected, true);
    else if (k === 'enter' || k === ' ') { ev.preventDefault(); if (held) putDown(); else pickUp(selected); }
    else if (k === ']' || k === '[' || k === 'arrowright' || k === 'arrowleft') {
      ev.preventDefault();
      const pool = items.filter(i => i.kind === selected.kind), i = pool.indexOf(selected);
      const next = pool[(i + (k === ']' || k === 'arrowright' ? 1 : -1) + pool.length) % pool.length];
      if (held) putDown(); select(next); focusOn(next);
    }
  }
  addEventListener('keydown', onKey, true);

  // ---------------------------------------------------------------- inspector
  const card = document.createElement('div'); card.className = 'studio-card'; card.hidden = true; host.appendChild(card);
  function select(it) { selected = it; showInspector(it); hooks.onSelect?.(it); }
  function hideInspector() { card.hidden = true; }
  function showInspector(it, reading = false) {
    const links = (it.links || []).filter(l => l.other).slice(0, 14);
    card.innerHTML = `<div class="kind">${esc(KIND[it.kind] || it.kind)}</div><h3>${esc(it.title)}</h3>${it.ko ? `<div class="ko">${esc(it.ko)}</div>` : ''}${it.path ? `<div class="path">${esc(it.path)}</div>` : ''}
      ${it.desc ? `<p>${esc(it.desc)}</p>` : ''}
      ${(() => { const g = window.__atlasCGR?.concepts[it.key]; return g ? `<div class="path" style="margin-top:-2px">code-graph-rag · ${g.defineCount} definitions · called from ${g.calledByModules} module${g.calledByModules === 1 ? '' : 's'} · ${g.testCalls} test calls</div>` : ''; })()}
      ${links.length ? `<div class="links">${links.map((l, i) => `<button data-l="${i}">${l.dir === 'out' ? '→' : '←'} ${esc(l.other.title)}</button>`).join('')}</div>` : ''}
      <div class="acts"><button class="btn primary" data-a="read">${reading ? 'Put down' : it.group.userData.sheet ? 'Pick up' : 'Frame it'}</button><button class="btn" data-a="align">Face it</button><button class="btn" data-a="pulse">Send a change</button>${hooks.openInMap && it.node && hooks.canOpen?.(it) ? '<button class="btn" data-a="map">Open in map</button>' : ''}</div>`;
    card.hidden = false;
    card.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { const o = links[+b.dataset.l].other; if (held) putDown(); select(o); focusOn(o); });
    card.querySelector('[data-a=read]').onclick = () => { if (held) { putDown(); showInspector(it); } else pickUp(it); };
    card.querySelector('[data-a=align]').onclick = () => { if (held) putDown(); focusOn(it, true); };
    card.querySelector('[data-a=pulse]').onclick = () => pulseFrom(it);
    card.querySelector('[data-a=map]')?.addEventListener('click', () => hooks.openInMap(it));
  }
  function pulseFrom(it) {
    it.lift = 1;
    const seen = new Set([it]), frontier = [[it, 0]];
    while (frontier.length) {
      const [x, depth] = frontier.shift(); if (depth > 3) continue;
      for (const c of cables) { const other = c.a === x ? c.b : c.b === x ? c.a : null; if (!other || seen.has(other)) continue; seen.add(other); sendPulse(c, depth * 700, c.b === x); frontier.push([other, depth + 1]); }
    }
    if (!cables.length || seen.size === 1) { // trace mode draws its cables on demand
      for (const l of (it.links || []).filter(l => l.dir === 'out').slice(0, 24)) { const c = cable(it, l.other, true); if (c) sendPulse(c); }
    }
  }

  // ---------------------------------------------------------------- loop
  let why = null, visible = false, raf = 0, last = performance.now(), focusDist = 20, dirty = true, restFrames = 0;
  const lastView = new THREE.Matrix4();
  function resize() {
    const r = host.getBoundingClientRect(); if (!r.width) return;
    renderer.setSize(r.width, r.height, false); composer.setSize(r.width, r.height); gtao.setSize(r.width, r.height); dirty = true;
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
    film.uniforms.res.value.set(r.width, r.height);
  }
  const ro = new ResizeObserver(resize); ro.observe(host);
  function loop(t) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(64, t - last); last = t;
    if (flight) {
      const u = Math.min(1, (t - flight.start) / flight.ms), e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      camera.position.lerpVectors(flight.p0, flight.p1, e); controls.target.lerpVectors(flight.t0, flight.t1, e);
      if (u >= 1) flight = null;
    }
    controls.update();
    // hover lift, with a spring's settle
    for (const it of items) {
      const want = held?.it === it ? 0 : (it === hovered ? 1 : it === selected ? 0.6 : 0);
      it.want = want; it.lift += (want - it.lift) * Math.min(1, dt / 90);
      it.group.position.y = it.baseY + it.lift * 0.05;
    }
    if (held) {
      const pose = holdPose(), u = Math.min(1, (t - held.start) / (REDUCED ? 1 : 750)), e = 1 - Math.pow(1 - u, 3);
      held.obj.position.lerpVectors(held.fromP, pose.p, e); held.obj.quaternion.slerpQuaternions(held.fromQ, pose.q, e);
    }
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i], u = (t - p.t0) / p.dur;
      if (u < 0) continue;
      if (u >= 1) { world.remove(p.s); p.s.geometry.dispose(); pulses.splice(i, 1); (p.reverse ? p.c.a : p.c.b).lift = 1; continue; }
      p.s.visible = true; p.s.position.copy(p.c.curve.getPointAt(p.reverse ? 1 - u : u)); p.s.position.y += 0.02;
      p.glow.intensity = 0.6 * Math.sin(u * Math.PI);
    }
    // depth of field follows attention: the held page, the selection, the hover, else the orbit target
    const subject = held ? held.obj.getWorldPosition(tmp) : selected ? centreOf(selected) : hovered ? centreOf(hovered) : controls.target;
    const want = camera.position.distanceTo(subject);
    focusDist += (want - focusDist) * Math.min(1, dt / 160);
    if (Math.abs(want - focusDist) < 0.002) focusDist = want;
    bokeh.uniforms.focus.value = focusDist;
    // deep focus for the wide shot, a shallow plane once there is a subject
    var apWant = held ? 0.0011 : selected ? 0.00014 : hovered ? 0.00009 : 0.00004;
    bokeh.uniforms.aperture.value += (apWant - bokeh.uniforms.aperture.value) * Math.min(1, dt / 220);
    if (Math.abs(apWant - bokeh.uniforms.aperture.value) < Math.max(2e-5, apWant * 0.08)) bokeh.uniforms.aperture.value = apWant; // settle, so the frame can rest
    // still photography: once nothing moves, stop sampling live and accumulate 32 jittered frames into one clean still
    camera.updateMatrixWorld();
    const viewMoved = camera.matrixWorld.elements.some((v, i) => Math.abs(v - lastView.elements[i]) > 1e-6);
    const moving = dirty || viewMoved || flight || held || pulses.length || items.some(i => Math.abs(i.lift - (i.want ?? 0)) > 0.002) || bokeh.uniforms.aperture.value !== apWant;
    why = { dirty, viewMoved, flight: !!flight, held: !!held, pulses: pulses.length, lift: items.filter(i => Math.abs(i.lift - (i.want ?? 0)) > 0.002).length, ap: Math.abs(bokeh.uniforms.aperture.value - apWant), rest: restFrames, idx: stillPass.accumulateIndex, still: stillPass.enabled };
    lastView.copy(camera.matrixWorld); dirty = false;
    restFrames = moving ? 0 : restFrames + 1;
    const still = restFrames > 3;
    if (still !== stillPass.enabled) { stillPass.enabled = still; livePass.enabled = !still; stillPass.accumulateIndex = -1; }
    film.uniforms.time.value = still || REDUCED ? 0.5 : t * 0.001; // a still carries one frozen grain, like one frame of film
    if (still && stillPass.accumulateIndex >= 32 && restFrames > 40) return; // the photograph is taken: stop drawing until something moves
    composer.render(dt / 1000);
    const n = still ? Math.min(32, Math.max(0, stillPass.accumulateIndex)) : 0;
    hud.textContent = still ? (n >= 32 ? 'Still · 32 samples' : `Developing · ${n}/32`) : 'Live';
    hud.dataset.state = still ? (n >= 32 ? 'done' : 'dev') : 'live';
  }

  return {
    async show(source) {
      visible = true; host.hidden = false; resize();
      await iconsReady();
      if (source && source !== this.current) {
        clear(); this.current = source;
        if (source.kind === 'vault') layoutVault(source.graph);
        else if (source.kind === 'trace') layoutTrace(source.T, source.spec);
        else if (source.kind === 'history') layoutHistory(source);
        else if (source.kind === 'spacetime') layoutSpacetime(source);
        fitAll(REDUCED ? 0 : 2600, true);
      }
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
      dirty = true;
      return { items: items.length, cables: cables.length };
    },
    hide() { visible = false; host.hidden = true; cancelAnimationFrame(raf); raf = 0; putDown(); },
    stats: () => ({ cam: camera.position.toArray().map(v => +v.toFixed(2)), target: controls.target.toArray().map(v => +v.toFixed(2)), bounds: (() => { box.makeEmpty(); for (const it of items) box.expandByObject(it.group); return [box.min.toArray().map(v => +v.toFixed(1)), box.max.toArray().map(v => +v.toFixed(1))]; })(), items: items.length, cables: cables.length, pulses: pulses.length, textures: disposables.filter(d => d.isTexture).length, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }),
    why: () => why,
    tapPhone(k, u, v) { const it = items.find(i => i.key === k); return it?.group.userData.phone?.tap(u, v) || null; },
    phoneHits(k) { const it = items.find(i => i.key === k); return it?.group.userData.phone?.state.hits || []; },
    setNow(t) { setNow(t); },
    focusKey(k) { const it = items.find(i => i.key === k); if (it) { select(it); focusOn(it, true); } return !!it; },
    current: null,
  };
}
