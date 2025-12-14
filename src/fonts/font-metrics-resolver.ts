import type { DetectedFont } from '../types/fonts.js';
import type { FontMetricsRecord } from './font-metrics-db.js';
import { getBuiltInFontMetricsDb } from './font-metrics-db.js';
import { normalizeFontName } from './font-name-normalizer.js';

export type ResolvedFontMatch = {
  record: FontMetricsRecord;
  score: number;
  reason: 'alias' | 'metrics' | 'fallback';
};

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function normalizeMetrics(v: number, unitsPerEm: number): number {
  const u = unitsPerEm > 0 ? unitsPerEm : 1000;
  return (v / u) * 1000;
}

function metricSim(a: number, b: number): number {
  const aa = Math.max(1e-6, Math.abs(a));
  const bb = Math.max(1e-6, Math.abs(b));
  const diff = Math.abs(a - b);
  const max = Math.max(aa, bb);
  return 1 - Math.min(diff / max, 1);
}

export class FontMetricsResolver {
  private records: FontMetricsRecord[];
  private aliasIndex: Map<string, FontMetricsRecord[]> = new Map();

  constructor(records: FontMetricsRecord[]) {
    this.records = records;
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.aliasIndex.clear();
    for (const r of this.records) {
      for (const a of r.aliases) {
        const k = normalizeFontName(a).family;
        if (!k) continue;
        const list = this.aliasIndex.get(k);
        if (list) list.push(r);
        else this.aliasIndex.set(k, [r]);
      }
      const famKey = normalizeFontName(r.family).family;
      if (famKey) {
        const list = this.aliasIndex.get(famKey);
        if (list) list.push(r);
        else this.aliasIndex.set(famKey, [r]);
      }
    }
  }

  resolveByName(name: string, opts?: { metrics?: DetectedFont['metrics'] }): ResolvedFontMatch {
    const n = normalizeFontName(name);
    const key = n.family;

    if (key) {
      const direct = this.aliasIndex.get(key);
      if (direct && direct.length > 0) {
        return { record: direct[0]!, score: 1, reason: 'alias' };
      }
    }

    const metrics = opts?.metrics;
    if (metrics) {
      return this.resolveByMetrics(metrics);
    }

    const fallback = this.pickFallbackForName(key);
    return { record: fallback, score: 0.5, reason: 'fallback' };
  }

  resolveDetectedFont(font: DetectedFont): ResolvedFontMatch {
    const byName = this.resolveByName(font.family || font.name, { metrics: font.metrics });
    if (byName.reason === 'alias') return byName;

    if (font.metrics) {
      const byMetrics = this.resolveByMetrics(font.metrics);
      if (byMetrics.score > byName.score) return byMetrics;
    }

    return byName;
  }

  resolveByMetrics(metrics: DetectedFont['metrics']): ResolvedFontMatch {
    const m = metrics;
    const ascent = normalizeMetrics(m.ascent, m.unitsPerEm);
    const descent = normalizeMetrics(m.descent, m.unitsPerEm);
    const capHeight = normalizeMetrics(m.capHeight, m.unitsPerEm);
    const xHeight = normalizeMetrics(m.xHeight, m.unitsPerEm);
    const averageWidth = normalizeMetrics(m.averageWidth, m.unitsPerEm);
    const maxWidth = normalizeMetrics(m.maxWidth, m.unitsPerEm);

    let best: FontMetricsRecord | undefined;
    let bestScore = -Infinity;

    for (const r of this.records) {
      const rm = r.metrics;
      const s =
        metricSim(ascent, rm.ascent) * 0.22 +
        metricSim(descent, rm.descent) * 0.18 +
        metricSim(capHeight, rm.capHeight) * 0.15 +
        metricSim(xHeight, rm.xHeight) * 0.15 +
        metricSim(averageWidth, rm.averageWidth) * 0.18 +
        metricSim(maxWidth, rm.maxWidth) * 0.12;

      if (s > bestScore) {
        bestScore = s;
        best = r;
      }
    }

    const fallback = this.pickFallbackForMetrics({ ascent, descent, averageWidth, maxWidth });
    const chosen = best ?? fallback;

    return {
      record: chosen,
      score: clamp01(bestScore),
      reason: best ? 'metrics' : 'fallback'
    };
  }

  estimateCharWidthUnits(ch: string, match: FontMetricsRecord): number {
    const overrides = match.charWidthOverrides;
    if (overrides && Object.prototype.hasOwnProperty.call(overrides, ch)) {
      const v = overrides[ch];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    }

    if (ch === ' ') return match.spaceWidth ?? match.metrics.averageWidth;
    if (/[0-9]/.test(ch)) return Math.max(1, (match.averageCharWidth ?? match.metrics.averageWidth) * 0.95);
    if (/[A-Z]/.test(ch)) return Math.max(1, (match.averageCharWidth ?? match.metrics.averageWidth) * 1.05);
    if (/[a-z]/.test(ch)) return Math.max(1, (match.averageCharWidth ?? match.metrics.averageWidth) * 0.98);
    if (/[,.;:!?]/.test(ch)) return Math.max(1, (match.averageCharWidth ?? match.metrics.averageWidth) * 0.55);

    return match.averageCharWidth ?? match.metrics.averageWidth;
  }

  estimateCharWidthPx(ch: string, match: FontMetricsRecord, fontSizePx: number): number {
    const units = this.estimateCharWidthUnits(ch, match);
    return (units / 1000) * Math.max(1, fontSizePx);
  }

  private pickFallbackForName(normalizedKey: string): FontMetricsRecord {
    const key = (normalizedKey || '').toLowerCase();
    if (key.includes('mono') || key.includes('courier')) return this.getById('default_mono');
    if (key.includes('serif') || key.includes('times') || key.includes('roman')) return this.getById('default_serif');
    return this.getById('default_sans');
  }

  private pickFallbackForMetrics(m: { ascent: number; descent: number; averageWidth: number; maxWidth: number }): FontMetricsRecord {
    const ratio = m.maxWidth > 0 ? m.averageWidth / m.maxWidth : 0;
    if (ratio > 0.88) return this.getById('default_mono');
    return this.getById('default_sans');
  }

  private getById(id: string): FontMetricsRecord {
    const found = this.records.find((r) => r.id === id);
    return found ?? this.records[0]!;
  }
}

let _defaultResolver: FontMetricsResolver | null = null;

export function getDefaultFontMetricsResolver(): FontMetricsResolver {
  if (_defaultResolver) return _defaultResolver;
  _defaultResolver = new FontMetricsResolver(getBuiltInFontMetricsDb());
  return _defaultResolver;
}
