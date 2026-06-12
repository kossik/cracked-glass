export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function remap(v: number, inLo: number, inHi: number, outLo: number, outHi: number): number {
  if (inHi === inLo) return outLo;
  return outLo + ((v - inLo) / (inHi - inLo)) * (outHi - outLo);
}

export function degToRad(d: number): number {
  return (d * Math.PI) / 180;
}

export function radToDeg(r: number): number {
  return (r * 180) / Math.PI;
}

// --- easings (pure) ---

export function smoothstep(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x) * (1 - x);
}

export function easeInCubic(t: number): number {
  const x = clamp01(t);
  return x * x * x;
}

export function easeOutQuart(t: number): number {
  const x = clamp01(t);
  const y = 1 - x;
  return 1 - y * y * y * y;
}

export function easeOutExpo(t: number): number {
  const x = clamp01(t);
  return x >= 1 ? 1 : 1 - Math.pow(2, -10 * x);
}

export function easeInExpo(t: number): number {
  const x = clamp01(t);
  return x <= 0 ? 0 : Math.pow(2, 10 * x - 10);
}

/**
 * The single number formatter for every emitted string.
 * Fixed precision, trailing zeros stripped, '-0' normalized, never exponent notation.
 * Guarantees byte-identical style strings for identical inputs.
 */
export function fmt(n: number, precision = 2): string {
  if (!Number.isFinite(n)) return '0';
  let s = n.toFixed(precision);
  if (s.indexOf('.') >= 0) {
    s = s.replace(/0+$/, '');
    if (s.endsWith('.')) s = s.slice(0, -1);
  }
  if (s === '-0') s = '0';
  return s;
}
