/** Pixel-diff two PNGs in a browser canvas; writes an amplified diff map. Usage: node tools/diff.mjs a.png b.png out.png */
import { readFileSync, writeFileSync } from 'node:fs';

const [a, b, out] = process.argv.slice(2);
const { chromium } = await import('playwright-core');
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage();

const res = await page.evaluate(
  async ([bufA, bufB]) => {
    const load = (arr) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.src = 'data:image/png;base64,' + arr;
      });
    const ia = await load(bufA);
    const ib = await load(bufB);
    const w = ia.width;
    const h = ia.height;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(ia, 0, 0);
    const da = ctx.getImageData(0, 0, w, h).data;
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(ib, 0, 0);
    const db = ctx.getImageData(0, 0, w, h).data;
    const diff = ctx.createImageData(w, h);
    let count = 0;
    let maxDelta = 0;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    for (let i = 0; i < da.length; i += 4) {
      const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > 0) {
        count++;
        if (d > maxDelta) maxDelta = d;
        const p = i / 4;
        const x = p % w;
        const y = (p / w) | 0;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
        diff.data[i] = 255;
        diff.data[i + 1] = Math.min(255, d * 8);
        diff.data[i + 2] = 0;
        diff.data[i + 3] = 255;
      } else {
        diff.data[i + 3] = 40;
        diff.data[i] = da[i];
        diff.data[i + 1] = da[i + 1];
        diff.data[i + 2] = da[i + 2];
      }
    }
    ctx.putImageData(diff, 0, 0);
    return { count, maxDelta, bbox: [x0, y0, x1, y1], total: w * h, png: c.toDataURL().split(',')[1] };
  },
  [readFileSync(a).toString('base64'), readFileSync(b).toString('base64')],
);

console.log(`diff pixels: ${res.count}/${res.total} (${((100 * res.count) / res.total).toFixed(3)}%) maxChannelDelta=${res.maxDelta} bbox=${res.bbox.join(',')}`);
if (out) writeFileSync(out, Buffer.from(res.png, 'base64'));
await browser.close();
