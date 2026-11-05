// Frame renderer: serves the project, drives the film page in headless Chromium
// (WebGL via SwiftShader on CPU) and writes one JPEG per frame.
//
//   node render/render.mjs --from 0 --to 1920 --out output/frames
//   node render/render.mjs --times 2.5,14,33 --w 1280 --h 720 --out /tmp/preview
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = createRequire('/opt/node22/lib/node_modules/')('playwright')); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]);
  return acc;
}, []));
const TL = JSON.parse(fs.readFileSync(path.join(ROOT, 'timeline.json'), 'utf8'));
const W = +(args.w || TL.width), H = +(args.h || TL.height);
const out = path.resolve(args.out || path.join(ROOT, 'output', 'frames'));
fs.mkdirSync(out, { recursive: true });

let frames;
if (args.times) frames = String(args.times).split(',').map(s => Math.round(parseFloat(s) * TL.fps));
else {
  const from = +(args.from ?? 0), to = +(args.to ?? Math.round(TL.duration * TL.fps)), step = +(args.step ?? 1);
  frames = []; for (let f = from; f < to; f += step) frames.push(f);
}
if (args.skipExisting) frames = frames.filter(f => !fs.existsSync(path.join(out, `f${String(f).padStart(5, '0')}.jpg`)));

const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json',
  '.ttf': 'font/ttf', '.jpg': 'image/jpeg', '.png': 'image/png', '.exr': 'application/octet-stream' };
const srv = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(p, (e, d) => {
    if (e) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(d);
  });
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--max-old-space-size=8192'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || args.verbose) console.log('[page]', m.type(), m.text()); });
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(`http://127.0.0.1:${port}/film/index.html?w=${W}&h=${H}`);
await page.waitForFunction('window.ready === true || window.initError', null, { timeout: 300000 });
const initErr = await page.evaluate(() => window.initError);
if (initErr) { console.error(initErr); process.exit(1); }

const t0 = Date.now();
let n = 0;
for (const f of frames) {
  const fs0 = Date.now();
  await page.evaluate(fr => window.film.renderFrame(fr), f);
  const data = await page.evaluate(q => window.film.capture(q), +(args.quality || 0.95));
  const name = args.times ? `t${(f / TL.fps).toFixed(2)}.jpg` : `f${String(f).padStart(5, '0')}.jpg`;
  fs.writeFileSync(path.join(out, name), Buffer.from(data.split(',')[1], 'base64'));
  n++;
  const el = (Date.now() - t0) / 1000, per = el / n;
  console.log(`frame ${f} (${(f / TL.fps).toFixed(2)}s) ${((Date.now() - fs0) / 1000).toFixed(2)}s  [${n}/${frames.length}] eta ${((frames.length - n) * per / 60).toFixed(1)} min`);
}
await browser.close(); srv.close();
