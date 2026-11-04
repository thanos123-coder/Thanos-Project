// Renders the animation frame by frame with headless Chromium.
//
//   node render.cjs preview <outDir> <t1> [t2 ...]   one PNG per time (seconds)
//   node render.cjs frames  <outDir> [fps] [workers] every frame as frames/000000.png
//   node render.cjs anchors <outDir>                  timing anchors (for the sound design)
//
// The page draws each frame synchronously from window.renderAt(t), so frames can be
// rendered in parallel and in any order.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HERE = __dirname;
const timeline = fs.readFileSync(path.join(HERE, 'build', 'timeline.json'), 'utf8');

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.error('[page]', m.text()); });
  page.on('pageerror', e => { console.error('[page error]', e.message); process.exitCode = 1; });
  await page.addInitScript({ content: `window.TIMELINE = ${timeline};` });
  await page.goto('file://' + path.join(HERE, 'index.html'));
  const duration = await page.evaluate(() => window.ready);
  return { page, duration };
}

async function grab(page, t) {
  const b64 = await page.evaluate(tt => { window.renderAt(tt); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, t);
  return Buffer.from(b64, 'base64');
}

async function main() {
  const [mode, outDir, ...rest] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();
  try {
    if (mode === 'preview') {
      const { page } = await openPage(browser);
      for (const s of rest) fs.writeFileSync(path.join(outDir, `t${Number(s).toFixed(2).padStart(6, '0')}.png`), await grab(page, Number(s)));
    } else if (mode === 'anchors') {
      const { page } = await openPage(browser);
      fs.writeFileSync(path.join(outDir, 'anchors.json'), JSON.stringify(await page.evaluate(() => window.ANCHORS), null, 1));
    } else if (mode === 'frames') {
      const fps = Number(rest[0] || 30), workers = Number(rest[1] || 3);
      const pages = await Promise.all(Array.from({ length: workers }, () => openPage(browser)));
      const n = Math.ceil(pages[0].duration * fps);
      fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({ fps, frames: n, duration: pages[0].duration }));
      let next = 0, done = 0;
      const t0 = Date.now();
      await Promise.all(pages.map(async ({ page }) => {
        for (;;) {
          const i = next++;
          if (i >= n) return;
          fs.writeFileSync(path.join(outDir, `${String(i).padStart(6, '0')}.png`), await grab(page, i / fps));
          if (++done % 150 === 0) console.log(`${done}/${n} frames, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
        }
      }));
      console.log(`rendered ${n} frames at ${fps} fps (${pages[0].duration.toFixed(2)}s) in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    } else {
      throw new Error('usage: render.cjs preview|frames <outDir> ...');
    }
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exit(1); });
