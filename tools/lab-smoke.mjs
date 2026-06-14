/** Interactive smoke test of /lab.html: playback, pin-compare, URL state round-trip. */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'output', 'lab-preview');
mkdirSync(outDir, { recursive: true });

const { createServer } = await import('vite');
const server = await createServer({ configFile: join(here, '..', 'vite.config.ts'), server: { port: 0 } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;

const { chromium } = await import('playwright-core');
let browser;
for (const opt of [{ channel: 'msedge' }, { channel: 'chrome' }, {}]) {
  try {
    browser = await chromium.launch({ ...opt, headless: true });
    break;
  } catch {
    /* next */
  }
}
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on('pageerror', (e) => console.error('PAGE ERROR:', e.message));

let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};

await page.goto(`${base}/lab.html?scene=hero-1&seed=7&t=0.2`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-stage]');

// 1. playback advances t
const tBefore = await page.locator('.tval').textContent();
await page.locator('button.play').click();
await page.waitForTimeout(700);
await page.locator('button.play').click(); // pause
const tAfter = await page.locator('.tval').textContent();
check(`playback advances t (${tBefore} -> ${tAfter})`, tBefore !== tAfter);

// 2. URL state sync + round-trip
await page.waitForTimeout(500); // debounce
const url = page.url();
check('URL carries packed state (?s=)', url.includes('?s='));
const tNow = await page.locator('.tval').textContent();
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-stage]');
const tRestored = await page.locator('.tval').textContent();
check(`state round-trips through URL (t ${tNow} -> ${tRestored})`, tNow === tRestored);

// 3. param override changes the render
const png1 = await page.locator('[data-stage]').screenshot();
await page.locator('.folder-title', { hasText: 'Refraction' }).click();
const offsetRow = page.locator('.prow', { hasText: 'offset px' });
await offsetRow.locator('input.num').fill('24');
await page.waitForTimeout(200);
const png2 = await page.locator('[data-stage]').screenshot();
check('refraction offset changes pixels', !png1.equals(png2));

// 4. pin & compare renders two stages
await page.locator('button', { hasText: 'pin' }).first().click();
await page.waitForTimeout(300);
const stages = await page.locator('.stage').count();
check(`pin shows two stages (${stages})`, stages === 2);
writeFileSync(join(outDir, 'ui-compare.png'), await page.screenshot());

// 5. shuffle-all produces a valid render (no page error = pass; plus pixels change)
await page.locator('button', { hasText: 'shuffle all' }).click();
await page.waitForTimeout(400);
const png3 = await page.locator('[data-stage]').screenshot();
check('shuffle all changes pixels', !png2.equals(png3));

// 6. scene switching works for every scene
for (const scene of ['hero-2', 'macro-edge', 'radial', 'web', 'horizontal', 'diagonal']) {
  await page.locator('.sidebar select').first().selectOption(scene);
  await page.waitForTimeout(350);
  const visible = await page.locator('[data-stage]').isVisible();
  check(`scene switch -> ${scene}`, visible);
}

await browser.close();
await server.close();
console.log(failures === 0 ? '\nAll lab smoke checks passed.' : `\n${failures} checks FAILED.`);
process.exit(failures === 0 ? 0 : 1);
