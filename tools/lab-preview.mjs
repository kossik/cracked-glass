/** Quick visual check of /lab.html: snapshot every scene + one full-UI shot. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'output', 'lab-preview');
mkdirSync(outDir, { recursive: true });

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

const SCENES = [
  ['hero-1', 0.5],
  ['hero-2', 0.5],
  ['macro-edge', 0.5],
  ['radial', 0.45],
  ['web', 0.25],
  ['horizontal', 0.5],
  ['diagonal', 0.5],
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
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('CONSOLE:', m.text());
});

for (const [scene, t] of SCENES) {
  await page.goto(`${base}/lab.html?scene=${scene}&seed=7&capture=1&t=${t}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-stage]');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const buf = await page.locator('[data-stage]').screenshot({ animations: 'disabled' });
  writeFileSync(join(outDir, `${scene}.png`), buf);
  console.log(`saved ${scene}.png`);
}

// Full UI (panel + stage) for layout review.
await page.goto(`${base}/lab.html?scene=hero-1&seed=7&t=0.5`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-stage]');
await page.waitForTimeout(400);
writeFileSync(join(outDir, 'ui-full.png'), await page.screenshot());
console.log('saved ui-full.png');

await browser.close();
await server.close();
