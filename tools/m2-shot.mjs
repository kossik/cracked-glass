/** One-off review shots: glass medium (anchored lens) vs content medium. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'output', 'lab-preview');
mkdirSync(outDir, { recursive: true });

const pack = (state) => Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');

const base = (scene, t, params = {}) => ({
  scene,
  seed: 7,
  t,
  quality: 'high',
  zoom: 1,
  panX: 0,
  panY: 0,
  debug: false,
  play: { duration: 4, easing: 'linear', loop: true, pingpong: false },
  params,
});

const STATES = [
  // Glass shatter: cracks must still be present mid-shatter (heal-fix), then linger as
  // staggered rings depart.
  ['glass-radial-t045', base('radial', 0.45, { 'fx.medium': 'glass', 'fx.optics.trackLight': true })],
  ['glass-radial-t055', base('radial', 0.55, { 'fx.medium': 'glass', 'fx.optics.trackLight': true })],
  // Glass ghost chroma (default 'normal' uses ghost on radial scene) - fringes must track
  // the light, not counter-spin.
  ['glass-hero-ghost', base('hero-1', 0.5, { 'fx.chroma.mode': 'ghost', 'fx.chroma.offsetPx': 6 })],
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
const baseUrl = `http://localhost:${server.httpServer.address().port}`;

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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

for (const [name, state] of STATES) {
  await page.goto(`${baseUrl}/lab.html?s=${pack(state)}&capture=1`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-stage]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  writeFileSync(join(outDir, `${name}.png`), await page.locator('[data-stage]').screenshot({ animations: 'disabled' }));
  console.log(`saved ${name}.png`);
}

await browser.close();
await server.close();
