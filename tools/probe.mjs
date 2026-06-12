/** Isolation probe: is same-t rendering stable consecutively? after visiting another t? */
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const FLAGS = [
  '--disable-gpu',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--disable-lcd-text',
  '--force-color-profile=srgb',
  '--force-device-scale-factor=1',
  '--hide-scrollbars',
];

const { createServer } = await import('vite');
const server = await createServer({ configFile: join(here, '..', 'vite.config.ts'), server: { port: 0 } });
await server.listen();
const base = `http://localhost:${server.httpServer.address().port}`;

const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: FLAGS });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await page.goto(`${base}/?scene=title&seed=7&capture=1&t=0`, { waitUntil: 'networkidle' });
await page.waitForSelector('[data-stage]');
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);

const snap = async (t) => {
  await page.evaluate(
    (v) => new Promise((res) => { window.__cgSetT(v); requestAnimationFrame(() => requestAnimationFrame(res)); }),
    t,
  );
  return await page.locator('[data-stage]').screenshot({ animations: 'disabled' });
};

const s1 = await snap(0);
const s2 = await snap(0);
console.log('consecutive same-t:        ', s1.equals(s2) ? 'IDENTICAL' : 'DIFF');
await snap(0.5);
const s3 = await snap(0);
console.log('after detour to t=0.5:     ', s1.equals(s3) ? 'IDENTICAL vs first' : 'DIFF vs first', '|', s2.equals(s3) ? 'IDENTICAL vs second' : 'DIFF vs second');
await snap(0.9);
await snap(0.3);
const s4 = await snap(0);
console.log('after detours 0.9, 0.3:    ', s3.equals(s4) ? 'IDENTICAL vs s3' : 'DIFF vs s3');
const s5 = await snap(0);
console.log('consecutive again:         ', s4.equals(s5) ? 'IDENTICAL' : 'DIFF');
writeFileSync(join(here, 'output', 'probe-s1.png'), s1);
writeFileSync(join(here, 'output', 'probe-s3.png'), s3);

await browser.close();
await server.close();
