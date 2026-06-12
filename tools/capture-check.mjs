/**
 * Determinism check on the real rendering stack (the consumer engine's contract):
 * screenshot a list of t values in two different orders within one session AND across
 * a page reload - every same-t pair must be byte-identical PNG.
 *
 * Browser: playwright-core with the system Edge/Chrome (no browser downloads).
 * Usage: node tools/capture-check.mjs [--scene title|title-anim|radial|text-svg] [--seed 7]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'output');
mkdirSync(outDir, { recursive: true });

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
const scenes = args.has('scene') ? [args.get('scene')] : ['title', 'radial', 'collapse', 'text-svg'];
const seed = args.get('seed') ?? '7';

const TS = [0, 0.15, 0.3, 0.45, 0.62, 0.8, 1];
const ORDER_A = [...TS];
const ORDER_B = [0.62, 1, 0.15, 0.8, 0, 0.45, 0.3];

/**
 * Deterministic-capture flags (what frame-capture engines run with): software
 * rasterization instead of the GPU lane, grayscale text AA instead of LCD subpixel
 * (subpixel AA flips with compositing-layer history), fixed color profile.
 */
const CAPTURE_FLAGS = [
  '--disable-gpu',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-lcd-text',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
  // threaded tile rasterization reorders blend accumulation -> last-ulp AA jitter on
  // heavily composited frames; one raster thread makes captures bit-stable
  '--num-raster-threads=1',
  // partial raster re-blends only damaged tiles, making pixels depend on visit HISTORY
  // for stacked mix-blend layers; full re-raster restores order independence
  '--disable-partial-raster',
];

async function launchBrowser() {
  const { chromium } = await import('playwright-core');
  const tries = [
    { channel: 'msedge' },
    { channel: 'chrome' },
    {},
  ];
  for (const opt of tries) {
    try {
      return await chromium.launch({ ...opt, headless: true, args: CAPTURE_FLAGS });
    } catch {
      // try next channel
    }
  }
  throw new Error('No Chromium available: install Edge/Chrome or run `npx playwright install chromium`.');
}

async function snap(page, t) {
  await page.evaluate(
    (v) =>
      new Promise((res) => {
        window.__cgSetT(v);
        requestAnimationFrame(() => requestAnimationFrame(res));
      }),
    t,
  );
  const stage = page.locator('[data-stage]');
  return await stage.screenshot({ animations: 'disabled' });
}

const { createServer } = await import('vite');
const server = await createServer({ configFile: join(here, '..', 'vite.config.ts'), server: { port: 0 } });
await server.listen();
const port = server.config.server.port === 0 ? server.httpServer.address().port : server.config.server.port;
const base = `http://localhost:${port}`;

const browser = await launchBrowser();
let failures = 0;

for (const scene of scenes) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const url = `${base}/?scene=${scene}&seed=${seed}&capture=1&t=0`;
  const settle = async () => {
    await page.waitForSelector('[data-stage]');
    // Engines wait for fonts + first stable raster before capturing; emulate that.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(450);
    // Warmup seeks: drive the page through a couple of t changes so Chromium's one-time
    // layer-promotion happens before the measured captures (engines seek before capture).
    await snap(page, 0.987654);
    await snap(page, 0.012345);
  };
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle();

  const runA = new Map();
  for (const t of ORDER_A) runA.set(t, await snap(page, t));
  const runB = new Map();
  for (const t of ORDER_B) runB.set(t, await snap(page, t));

  // cross-reload run
  await page.goto(url, { waitUntil: 'networkidle' });
  await settle();
  const runC = new Map();
  for (const t of ORDER_A) runC.set(t, await snap(page, t));

  for (const t of TS) {
    const ab = runA.get(t).equals(runB.get(t));
    const ac = runA.get(t).equals(runC.get(t));
    const label = `${scene} t=${t}`;
    if (!ab || !ac) {
      failures++;
      console.log(`FAIL  ${label}  (in-session: ${ab ? 'ok' : 'DIFF'}, cross-reload: ${ac ? 'ok' : 'DIFF'})`);
      writeFileSync(join(outDir, `${scene}-t${t}-A.png`), runA.get(t));
      writeFileSync(join(outDir, `${scene}-t${t}-B.png`), runB.get(t));
      writeFileSync(join(outDir, `${scene}-t${t}-C.png`), runC.get(t));
    } else {
      console.log(`PASS  ${label}`);
    }
  }
  // keep a reference strip for visual inspection
  for (const t of [0, 0.3, 0.62, 1]) {
    writeFileSync(join(outDir, `${scene}-t${String(t).replace('.', '_')}.png`), runA.get(t));
  }
  await ctx.close();
}

await browser.close();
await server.close();
console.log(failures === 0 ? '\nAll determinism checks passed.' : `\n${failures} checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
