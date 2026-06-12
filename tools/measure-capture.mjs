/**
 * Per-frame capture cost across quality presets - the budget table from the plan.
 * Usage: node tools/measure-capture.mjs
 */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

const CAPTURE_FLAGS = [
  '--disable-gpu',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-lcd-text',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  '--num-raster-threads=1',
  '--disable-partial-raster',
];

async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  for (const opt of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
    try {
      return await chromium.launch({ ...opt, headless: true, args: CAPTURE_FLAGS });
    } catch {
      /* next */
    }
  }
  throw new Error('No Chromium available.');
}

const { createServer } = await import('vite');
const server = await createServer({ configFile: join(here, '..', 'vite.config.ts'), server: { port: 0 } });
await server.listen();
const port = server.httpServer.address().port;
const base = `http://localhost:${port}`;

const browser = await launchBrowser();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

const FRAMES = 30;
const rows = [];
for (const scene of ['title', 'radial', 'collapse', 'text-svg']) {
  for (const quality of ['draft', 'normal', 'high']) {
    await page.goto(`${base}/?scene=${scene}&seed=7&quality=${quality}&capture=1&t=0`, {
      waitUntil: 'networkidle',
    });
    await page.waitForSelector('[data-stage]');
    const stage = page.locator('[data-stage]');
    // warmup
    await stage.screenshot();
    const t0 = Date.now();
    for (let i = 0; i <= FRAMES; i++) {
      const t = i / FRAMES;
      await page.evaluate(
        (v) =>
          new Promise((res) => {
            window.__cgSetT(v);
            requestAnimationFrame(() => requestAnimationFrame(res));
          }),
        t,
      );
      await stage.screenshot();
    }
    const ms = (Date.now() - t0) / (FRAMES + 1);
    rows.push({ scene, quality, msPerFrame: Number(ms.toFixed(1)) });
    console.log(`${scene.padEnd(10)} ${quality.padEnd(7)} ${ms.toFixed(1)} ms/frame (set t + element screenshot)`);
  }
}

console.table(rows);
await browser.close();
await server.close();
