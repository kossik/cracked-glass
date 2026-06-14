import type { QualityPreset, QualitySettings } from '../types';

export const qualityPresets: Record<QualityPreset, QualitySettings> = {
  draft: { chromaGhosts: 0, motionGhosts: 0, smearGhosts: 0, bevel: false, edgeDistortion: false, spectrum: false, stubCap: 0, maxBlurPx: 0, grain: false, microShardCap: 40 },
  normal: { chromaGhosts: 2, motionGhosts: 0, smearGhosts: 2, bevel: true, edgeDistortion: true, spectrum: true, stubCap: 80, maxBlurPx: 2, grain: false, microShardCap: 140 },
  high: { chromaGhosts: 2, motionGhosts: 0, smearGhosts: 3, bevel: true, edgeDistortion: true, spectrum: true, stubCap: 200, maxBlurPx: 4, grain: true, microShardCap: 400 },
};

export function resolveQuality(q: QualityPreset | QualitySettings | undefined): QualitySettings {
  if (q === undefined) return qualityPresets.normal;
  if (typeof q === 'string') return qualityPresets[q] ?? qualityPresets.normal;
  return { ...qualityPresets.normal, ...q };
}
