import type { NormalizedGlyphItem, LineGeometryModel } from './types.js';
import { getDefaultFontMetricsResolver } from '../../fonts/font-metrics-resolver.js';

export function buildLineGeometryModel(items: NormalizedGlyphItem[]): LineGeometryModel {
  const ordered = [...(items || [])].sort((a, b) => a.x - b.x);
  const estimatedCharWidth = estimateCharWidthFromItems(ordered);

  const gapsByChar: number[] = [];
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    const gapPx = b.x - (a.x + a.width);
    if (!Number.isFinite(gapPx) || gapPx < 0) continue;
    gapsByChar.push(gapPx / Math.max(0.01, estimatedCharWidth));
  }

  const wordBreakThresholdByChar = deriveWordBreakThresholdByChar(gapsByChar);

  return {
    estimatedCharWidth,
    wordBreakThresholdByChar
  };
}

function estimateCharWidthFromItems(items: NormalizedGlyphItem[]): number {
  if (!items || items.length === 0) return 6;
  const widths: number[] = [];
  const avgFontSize =
    items.reduce((acc, t) => acc + Math.max(1, t.fontSize || 0), 0) / Math.max(1, items.length);

  const resolver = getDefaultFontMetricsResolver();
  const predictedByStyle = new Map<string, number>();

  for (const item of items) {
    const t = (item.text || '').replace(/\s+/g, '');
    const len = t.length;
    if (len >= 1 && item.width > 0) {
      const v = item.width / len;
      const clamped = Math.max(avgFontSize * 0.25, Math.min(avgFontSize * 1.2, v));
      widths.push(clamped);
    }

    const styleKey = `${item.fontFamily}|${Math.round(Math.max(1, item.fontSize))}`;
    if (!predictedByStyle.has(styleKey)) {
      const match = resolver.resolveByName(item.fontFamily);
      const px = resolver.estimateCharWidthPx('n', match.record, Math.max(1, item.fontSize || avgFontSize));
      if (Number.isFinite(px) && px > 0) predictedByStyle.set(styleKey, px);
    }
  }

  for (const v of predictedByStyle.values()) widths.push(v);

  if (widths.length === 0) return Math.max(1, avgFontSize) * 0.55;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(widths.length / 2)] || Math.max(1, avgFontSize) * 0.55;
}

function deriveWordBreakThresholdByChar(gapsByChar: number[]): number {
  const gaps = gapsByChar
    .filter((g) => Number.isFinite(g) && g >= 0)
    .map((g) => Math.max(0, Math.min(6, g)));
  if (gaps.length === 0) return 0.95;
  if (gaps.length === 1) {
    const g = gaps[0] || 0;
    if (g >= 0.55) return Math.max(0.25, Math.min(1.2, g * 0.85));
    if (g >= 0.25) return 0.35;
    return 0.65;
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const p = (q: number): number => {
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * q)));
    return sorted[idx] || 0;
  };
  const p25 = p(0.25);
  const p50 = p(0.5);
  const p75 = p(0.75);
  const p90 = p(0.9);

  const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

  if (p25 >= 0.32) {
    return clamp(p25 * 0.9, 0.28, 0.95);
  }

  const { c0, c1 } = kMeans2(gaps);
  const small = Math.min(c0, c1);
  const large = Math.max(c0, c1);

  const separation = large - small;
  const ratio = small > 0 ? large / small : large;
  if (separation < 0.12 || ratio < 1.5) {
    // When the distribution isn't clearly bimodal, prefer a quantile-driven threshold.
    // This avoids forcing a too-high threshold (which mashes words together).
    if (p90 >= 0.38 && p50 <= 0.18) {
      return clamp((p50 + p90) / 2, 0.25, 1.1);
    }
    if (p50 >= 0.35) {
      return clamp(p50 * 0.9, 0.25, 1.1);
    }
    return clamp(p90 * 0.9, 0.25, 1.25);
  }

  const threshold = (small + large) / 2;
  const guarded = Math.max(threshold, p75 * 0.85);
  return clamp(guarded, 0.25, 1.35);
}

function kMeans2(values: number[]): { c0: number; c1: number } {
  const sorted = [...values].sort((a, b) => a - b);
  let c0 = sorted[0] ?? 0;
  let c1 = sorted[sorted.length - 1] ?? 1;

  for (let iter = 0; iter < 12; iter++) {
    const g0: number[] = [];
    const g1: number[] = [];
    for (const v of sorted) {
      if (Math.abs(v - c0) <= Math.abs(v - c1)) g0.push(v);
      else g1.push(v);
    }

    const nextC0 = g0.length > 0 ? g0.reduce((a, b) => a + b, 0) / g0.length : c0;
    const nextC1 = g1.length > 0 ? g1.reduce((a, b) => a + b, 0) / g1.length : c1;

    if (Math.abs(nextC0 - c0) < 1e-3 && Math.abs(nextC1 - c1) < 1e-3) break;
    c0 = nextC0;
    c1 = nextC1;
  }

  return { c0, c1 };
}
