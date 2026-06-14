/**
 * Snapshot a curated set of (scene, t) pairs for visual review.
 *
 * Two modes:
 *   node tools/showcase.mjs                       - built-in demo shot list
 *   node tools/showcase.mjs --shots <file.json>   - lab shot list exported from /lab.html
 *     (array of { name, s, t }: `s` is the packed lab state from the "export shots" button)
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'output', 'showcase');
mkdirSync(outDir, { recursive: true });

const shotsArg = process.argv.indexOf('--shots');
const labShots = shotsArg >= 0 ? JSON.parse(readFileSync(process.argv[shotsArg + 1], 'utf8')) : null;

const SHOTS = [
  ['title-anim', 0.22],
  ['title-anim', 0.45],
  ['title-anim', 0.66],
  ['title', 1],
  ['radial', 0.25],
  ['radial', 0.45],
  ['radial', 0.55],
  ['collapse', 0.3],
  ['collapse', 0.5],
  ['collapse', 0.68],
  ['text-svg', 0.3],
  ['text-svg', 0.5],
  ['text-svg', 0.62],
];

const FLAGS = [
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

const { createServer } = await import('vite');
const server = await createServer({ configFile: join(here, '..', 'vite.config.ts'), server: { port: 0 } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;

const { chromium } = await import('playwright-core');
let browser;
for (const opt of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
  try {
    browser = await chromium.launch({ ...opt, headless: true, args: FLAGS });
    break;
  } catch {
    /* next */
  }
}
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

const settle = async (url) => {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-stage]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
};

const snapTo = async (t, name) => {
  await page.evaluate(
    (v) => new Promise((res) => { window.__cgSetT(v); requestAnimationFrame(() => requestAnimationFrame(res)); }),
    t,
  );
  const buf = await page.locator('[data-stage]').screenshot({ animations: 'disabled' });
  writeFileSync(join(outDir, name), buf);
  console.log(`saved ${name}`);
};

if (labShots) {
  // Lab shot list: each entry pins the full lab state via the packed `s` URL param.
  let currentS = null;
  for (const shot of labShots) {
    if (shot.s !== currentS) {
      await settle(`${base}/lab.html?s=${shot.s}&capture=1&t=0`);
      currentS = shot.s;
    }
    const safe = String(shot.name ?? `shot-${shot.t}`).replace(/[^a-z0-9_-]+/gi, '_');
    await snapTo(shot.t, `${safe}.png`);
  }
} else {
  let currentScene = null;
  for (const [scene, t] of SHOTS) {
    if (scene !== currentScene) {
      await settle(`${base}/?scene=${scene}&seed=7&capture=1&t=0`);
      currentScene = scene;
    }
    await snapTo(t, `${scene}-${String(t).replace('.', '')}.png`);
  }
}

await browser.close();
await server.close();
