import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * The consumer engine's contract, encoded as a test: the library must contain no clocks,
 * no self-running animations, no Math.random, no network/storage, no eval.
 */
const FORBIDDEN: Array<[string, RegExp]> = [
  ['setTimeout', /\bsetTimeout\s*\(/],
  ['setInterval', /\bsetInterval\s*\(/],
  ['requestAnimationFrame', /requestAnimationFrame/],
  ['requestIdleCallback', /requestIdleCallback/],
  ['Date.now', /\bDate\.now\b/],
  ['new Date()', /new\s+Date\s*\(/],
  ['performance.*', /\bperformance\s*\./],
  ['Math.random', /Math\.random/],
  ['eval', /\beval\s*\(/],
  ['new Function', /new\s+Function\s*\(/],
  ['@keyframes', /@keyframes/],
  ['CSS transition', /[^a-zA-Z-]transition\s*:/],
  ['CSS animation', /[^a-zA-Z-]animation\s*:/],
  ['element.animate()', /\.animate\s*\(/],
  ['SMIL <animate', /<animate/],
  ['fetch', /\bfetch\s*\(/],
  ['XMLHttpRequest', /XMLHttpRequest/],
  ['WebSocket', /\bWebSocket\b/],
  ['localStorage', /localStorage/],
  ['sessionStorage', /sessionStorage/],
  ['indexedDB', /indexedDB/],
  ['dynamic import()', /[^.\w]import\s*\(/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

/** The ban applies to code; doc comments may name the forbidden APIs. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('forbidden APIs are absent from src/', () => {
  const files = walk(join(here, '..', 'src'));

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const [label, re] of FORBIDDEN) {
    it(`no ${label}`, () => {
      const offenders = files.filter((f) => re.test(stripComments(readFileSync(f, 'utf8'))));
      expect(offenders, `${label} found in: ${offenders.join(', ')}`).toHaveLength(0);
    });
  }

  it('package.json has zero runtime deps and no lifecycle scripts', () => {
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
    expect(pkg.dependencies ?? {}).toEqual({});
    for (const s of Object.keys(pkg.scripts ?? {})) {
      expect(['preinstall', 'install', 'postinstall', 'prepare']).not.toContain(s);
    }
    expect(pkg.sideEffects).toBe(false);
  });
});
