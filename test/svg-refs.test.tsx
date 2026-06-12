import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateFracture, staticCrackedTimeline } from '../src/index';
import { CrackedGlass, CrackedGlassText } from '../src/react/index';

/**
 * The capture engine's gotcha, encoded as a test: every url(#id) / href="#id" reference
 * must resolve to an id defined inside the SAME <svg> element. HTML-tier shard styles
 * must be entirely url()-free.
 */

function svgBlocks(markup: string): string[] {
  // No nested <svg> in this library, so a non-greedy scan is exact.
  return markup.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
}

function refsIn(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/url\(#([^)]+)\)/g)) out.push(m[1]);
  for (const m of s.matchAll(/href="#([^"]+)"/g)) out.push(m[1]);
  return out;
}

function idsIn(s: string): Set<string> {
  const out = new Set<string>();
  for (const m of s.matchAll(/id="([^"]+)"/g)) out.add(m[1]);
  return out;
}

describe('same-svg reference rule (headless capture safety)', () => {
  const titlePattern = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });
  const radialPattern = generateFracture({ mode: 'radial', width: 960, height: 540, seed: 7 });

  const cases: Array<[string, string]> = [
    [
      'CrackedGlass static title (high quality, grain on)',
      renderToStaticMarkup(
        <CrackedGlass t={1} pattern={titlePattern} fx={{ quality: 'high', timeline: staticCrackedTimeline }}>
          <span>content</span>
        </CrackedGlass>,
      ),
    ],
    [
      'CrackedGlass radial mid-shatter (ghost chroma)',
      renderToStaticMarkup(
        <CrackedGlass
          t={0.62}
          pattern={radialPattern}
          fx={{
            quality: 'high',
            timeline: { crackStart: 0.02, crackEnd: 0.3, shatterStart: 0.38 },
            chroma: { mode: 'ghost' },
          }}
        >
          <span>content</span>
        </CrackedGlass>,
      ),
    ],
    [
      'CrackedGlassText premium tier',
      renderToStaticMarkup(
        <CrackedGlassText t={0.7} pattern={titlePattern} fx={{ quality: 'high' }} text="CRACKED" />,
      ),
    ],
    [
      'CrackedGlass collapse mid-crumble (bevel on)',
      renderToStaticMarkup(
        <CrackedGlass
          t={0.55}
          pattern={generateFracture({ mode: 'collapse', width: 960, height: 540, seed: 7 })}
          fx={{ quality: 'high', timeline: { crackStart: 0.02, crackEnd: 0.28, shatterStart: 0.34 } }}
        >
          <span>content</span>
        </CrackedGlass>,
      ),
    ],
  ];

  for (const [name, markup] of cases) {
    it(`${name}: every url(#)/href(#) resolves within its own <svg>`, () => {
      const blocks = svgBlocks(markup);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        const ids = idsIn(block);
        for (const ref of refsIn(block)) {
          expect(ids.has(ref), `reference #${ref} not defined inside its <svg>`).toBe(true);
        }
      }
    });

    it(`${name}: no url(#) outside <svg> blocks (HTML tier is url-free)`, () => {
      const withoutSvg = markup.replace(/<svg[\s\S]*?<\/svg>/g, '');
      expect(withoutSvg).not.toMatch(/url\(#/);
    });
  }

  it('two same-seed instances need distinct instanceIds (documented contract)', () => {
    const a = generateFracture({ mode: 'title', width: 100, height: 100, seed: 1 });
    const b = generateFracture({ mode: 'title', width: 100, height: 100, seed: 1, instanceId: 'other' });
    expect(a.instanceId).not.toBe(b.instanceId);
  });
});
