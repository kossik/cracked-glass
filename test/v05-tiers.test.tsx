import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { generateFracture, staticCrackedTimeline } from '../src/index';
import { CrackedGlass, CrackedGlassText } from '../src/react/index';

/** M2 render-tier wiring: edge refraction ring + edge spectrum in both tiers. */

const heroPattern = generateFracture({ mode: 'hero', width: 960, height: 540, seed: 7 });
const titlePattern = generateFracture({ mode: 'title', width: 880, height: 360, seed: 7 });

const m2fx = {
  timeline: staticCrackedTimeline,
  edgeDistortion: { strength: 0.8, widthPx: 12 },
  spectrum: { edgeOnly: 1, count: 1, opacity: 0.3 },
} as const;

describe('M2 HTML tier', () => {
  const markup = renderToStaticMarkup(
    <CrackedGlass t={0.5} pattern={heroPattern} fx={m2fx}>
      <span>content</span>
    </CrackedGlass>,
  );

  it('renders the edge ring clone with a url-free path() clip', () => {
    const clips = markup.match(/clip-path:path\(&quot;M[^)]*\)/g) ?? [];
    expect(clips.length).toBeGreaterThan(0);
    expect(markup).not.toMatch(/clip-path:[^;]*url\(#/);
  });

  it('ring clip carries two subpaths (keyhole hole via reversed winding)', () => {
    const m = markup.match(/path\(&quot;(M[^&]*)&quot;\)/);
    expect(m).not.toBeNull();
    expect((m![1].match(/M/g) ?? []).length).toBe(2);
    expect((m![1].match(/Z/g) ?? []).length).toBe(2);
  });
});

describe('M2 SVG text tier', () => {
  const markup = renderToStaticMarkup(
    <CrackedGlassText t={0.7} pattern={titlePattern} fx={{ ...m2fx, quality: 'high' }} text="CRACKED" />,
  );

  it('every ring clipPath reference resolves within the same <svg>', () => {
    const blocks = markup.match(/<svg[\s\S]*?<\/svg>/g) ?? [];
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const ids = new Set([...block.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
      for (const m of block.matchAll(/url\(#([^)]+)\)/g)) {
        expect(ids.has(m[1]), `reference #${m[1]} not defined inside its <svg>`).toBe(true);
      }
    }
  });

  it('emits ring clipPaths and an edge content layer per shard', () => {
    expect(markup).toMatch(/id="[^"]*-ring\d+"/);
    const ringDs = [...markup.matchAll(/<clipPath id="[^"]*-ring\d+"[^>]*><path d="(M[^"]+)"/g)];
    expect(ringDs.length).toBe(titlePattern.shards.length);
    for (const m of ringDs) expect((m[1].match(/M/g) ?? []).length).toBe(2);
  });
});
