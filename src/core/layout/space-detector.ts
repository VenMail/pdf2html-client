import type { DocumentStatistics } from './types.js';
import type { PDFTextContent } from '../../types/pdf.js';
import { getDefaultFontMetricsResolver } from '../../fonts/font-metrics-resolver.js';

export type LineGapModel = {
  estimatedCharWidth: number;
  wordBreakThresholdByChar: number;
};

export type SpaceDetectorContext = {
  estimatedCharWidth?: number;
  wordBreakThresholdByChar?: number;
  lineModel?: LineGapModel;
};

export class StatisticalSpaceDetector {
  constructor(private stats: DocumentStatistics) {}

  buildLineGapModel(items: PDFTextContent[]): LineGapModel {
    const ordered = [...(items || [])].sort((a, b) => a.x - b.x);
    const estimatedCharWidth = this.estimateCharWidthFromItems(ordered);

    const gapsByChar: number[] = [];
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i];
      const b = ordered[i + 1];
      const gapPx = b.x - (a.x + a.width);
      if (!Number.isFinite(gapPx) || gapPx < 0) continue;
      gapsByChar.push(gapPx / Math.max(0.01, estimatedCharWidth));
    }

    const wordBreakThresholdByChar = this.deriveWordBreakThresholdByChar(gapsByChar);
    return {
      estimatedCharWidth,
      wordBreakThresholdByChar
    };
  }

  shouldInsertSpace(prev: PDFTextContent, next: PDFTextContent, context?: SpaceDetectorContext): boolean {
    const prevText = (prev.text || '').trim();
    const nextText = (next.text || '').trim();

    const isSingleAlphaNum = (s: string): boolean => /^[A-Za-z0-9]$/.test((s || '').trim());
    const isShortAlpha = (s: string): boolean => /^[A-Za-z]{1,3}$/.test((s || '').trim());
    const isEmailish = (a: string, b: string): boolean => {
      const left = (a || '').trim();
      const right = (b || '').trim();
      if (!left || !right) return false;
      if (left.includes('@') || right.includes('@')) return true;
      if (left.endsWith('@') || right.startsWith('@')) return true;
      if (left.endsWith('.') && /^[A-Za-z]{2,6}$/.test(right)) return true;
      if (/^[A-Za-z0-9._%+-]+$/.test(left) && /^[A-Za-z0-9._%+-]+$/.test(right) && (left.includes('.') || right.includes('.'))) {
        return true;
      }
      return false;
    };

    const rawGap = next.x - (prev.x + prev.width);
    const avgFontSize = Math.max(1, (prev.fontSize + next.fontSize) / 2);
    const tolerance = avgFontSize * 0.25;
    const gapPx = rawGap < 0 && rawGap >= -tolerance ? 0 : rawGap;
    if (gapPx < 0) return false;

    const lineModel = context?.lineModel;
    const estimatedCharWidth =
      context?.estimatedCharWidth ?? lineModel?.estimatedCharWidth ?? this.estimateCharWidth(prev, next, avgFontSize);
    const gapByChar = gapPx / Math.max(0.01, estimatedCharWidth);

    const urlStart = this.isUrlStart(nextText);
    const inUrl = this.isInUrlContext(prevText, nextText);

    // Never insert spaces *inside* URLs.
    if (inUrl) {
      // Allow a space just before a URL starts if there is a clear break.
      if (urlStart && /[A-Za-z0-9)]$/.test(prevText)) {
        const t = context?.wordBreakThresholdByChar ?? lineModel?.wordBreakThresholdByChar ?? 0.85;
        return gapByChar >= Math.min(0.95, Math.max(0.65, t));
      }
      return false;
    }

    // Never insert before punctuation.
    if (/^[,.;:!?)]/.test(nextText)) return false;

    const baseThreshold =
      context?.wordBreakThresholdByChar ?? lineModel?.wordBreakThresholdByChar ?? 0.85;

    // Avoid splitting digit sequences (ticket numbers, sequence numbers) unless the gap is huge.
    const digitToDigit = /[0-9]$/.test(prevText) && /^[0-9]/.test(nextText);
    let effectiveThreshold = digitToDigit ? Math.max(baseThreshold, 1.35) : baseThreshold;

    if (isEmailish(prevText, nextText)) {
      effectiveThreshold = Math.max(effectiveThreshold, 2.2);
    }

    const singleToSingle = isSingleAlphaNum(prevText) && isSingleAlphaNum(nextText);
    if (singleToSingle) {
      effectiveThreshold = Math.max(effectiveThreshold, 2.2);
    }

    // If both sides are multi-character tokens (3+ chars), treat even small gaps as likely word breaks.
    // This is language-agnostic and prevents regressions like AGENTCOPY / RecordLocator.
    // Lowered threshold to 0.15 to catch cases like "connectingfinance" -> "connecting finance"
    // This check must come BEFORE the shortAlphaPair check to take precedence.
    const multiToken = prevText.length >= 3 && nextText.length >= 3;
    const alphaLike = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
    if (multiToken && alphaLike) {
      effectiveThreshold = Math.min(effectiveThreshold, 0.15);
    }

    // For very short alpha fragments (1-3 chars), be more conservative to avoid splitting abbreviations
    // Only apply this if NOT already handled by multiToken check above
    const shortAlphaPair = isShortAlpha(prevText) && isShortAlpha(nextText);
    const alphaLikeShort = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
    if (shortAlphaPair && alphaLikeShort && !multiToken) {
      effectiveThreshold = Math.max(effectiveThreshold, 1.85);
    }

    // Insert after common separators even if the numeric spacing is tight.
    if (/[:;,]$/.test(prevText) && /^[A-Za-z0-9]/.test(nextText)) {
      effectiveThreshold = Math.min(effectiveThreshold, 0.28);
    }

    // Case boundary: lower-case followed by Upper-case often indicates a missing space between words
    // (e.g. "GateBoarding", "MuhammedInternational"). Be aggressive here.
    const caseBoundary = /[a-z]$/.test(prevText) && /^[A-Z]/.test(nextText);
    if (caseBoundary && prevText.length >= 2 && nextText.length >= 2) {
      effectiveThreshold = Math.min(effectiveThreshold, 0.08);
    }

    // Common short connector words often render with very tight glyph gaps in PDFs.
    // Allow a smaller threshold for these to avoid collapsing phrases like "Airport to".
    const commonShort = new Set(['to', 'of', 'in', 'on', 'at', 'by', 'or', 'an', 'as', 'if', 'is']);
    const nextLower = nextText.toLowerCase();
    const shortConnector = nextLower.length <= 2 && commonShort.has(nextLower);
    if (shortConnector && /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText)) {
      effectiveThreshold = Math.min(effectiveThreshold, 0.18);
    }

    const prevLower = prevText.toLowerCase();
    const prevIsShortConnector = prevLower.length <= 2 && commonShort.has(prevLower);
    if (prevIsShortConnector && /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText)) {
      effectiveThreshold = Math.min(effectiveThreshold, 0.18);
    }

    return gapByChar >= effectiveThreshold;
  }

  private estimateCharWidth(prev: PDFTextContent, next: PDFTextContent, avgFontSize: number): number {
    const prevText = (prev.text || '').replace(/\s+/g, '');
    const nextText = (next.text || '').replace(/\s+/g, '');
    const prevLen = prevText.length;
    const nextLen = nextText.length;

    const candidates: number[] = [];
    if (prevLen >= 1) candidates.push(prev.width / prevLen);
    if (nextLen >= 1) candidates.push(next.width / nextLen);

    const resolver = getDefaultFontMetricsResolver();
    const prevMatch = resolver.resolveByName(prev.fontFamily || '');
    const nextMatch = resolver.resolveByName(next.fontFamily || '');
    candidates.push(resolver.estimateCharWidthPx('n', prevMatch.record, avgFontSize));
    candidates.push(resolver.estimateCharWidthPx('n', nextMatch.record, avgFontSize));
    candidates.push(avgFontSize * 0.55);

    const filtered = candidates
      .filter((v) => Number.isFinite(v) && v > 0)
      .map((v) => Math.max(avgFontSize * 0.25, Math.min(avgFontSize * 1.2, v)));
    if (filtered.length === 0) return avgFontSize * 0.55;
    filtered.sort((a, b) => a - b);
    return filtered[Math.floor(filtered.length / 2)] || avgFontSize * 0.55;
  }

  private estimateCharWidthFromItems(items: PDFTextContent[]): number {
    if (!items || items.length === 0) return Math.max(1, this.stats.medianFontSize) * 0.55;
    const widths: number[] = [];
    const avgFontSize = items.reduce((acc, t) => acc + Math.max(1, t.fontSize || 0), 0) / Math.max(1, items.length);

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

      const styleKey = `${item.fontFamily}|${Math.round(Math.max(1, item.fontSize || avgFontSize))}`;
      if (!predictedByStyle.has(styleKey)) {
        const match = resolver.resolveByName(item.fontFamily || '');
        const px = resolver.estimateCharWidthPx('n', match.record, Math.max(1, item.fontSize || avgFontSize));
        if (Number.isFinite(px) && px > 0) predictedByStyle.set(styleKey, px);
      }
    }

    for (const v of predictedByStyle.values()) widths.push(v);
    if (widths.length === 0) return Math.max(1, avgFontSize) * 0.55;
    widths.sort((a, b) => a - b);
    const mid = Math.floor(widths.length / 2);
    return widths[mid] || Math.max(1, avgFontSize) * 0.55;
  }

  private deriveWordBreakThresholdByChar(gapsByChar: number[]): number {
    const gaps = gapsByChar
      .filter((g) => Number.isFinite(g) && g >= 0)
      .map((g) => Math.max(0, Math.min(6, g)));
    if (gaps.length === 0) return 0.95;
    if (gaps.length === 1) {
      const g = gaps[0] || 0;
      // With only one gap we typically have two PDF items on the line.
      // If the gap is at least moderately sized, treat it as a word break.
      if (g >= 0.18) return Math.max(0.2, Math.min(0.95, g * 0.85));
      // Otherwise be conservative (likely a split glyph / kerning).
      return Math.max(0.95, Math.min(1.6, g * 1.25));
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

    // If the whole line looks like word-tokenized chunks (gaps are generally medium/large),
    // use a low threshold so we don't collapse all spaces.
    if (p25 >= 0.32) {
      return Math.max(0.28, Math.min(0.95, p25 * 0.9));
    }

    const { c0, c1 } = this.kMeans2(gaps);
    const small = Math.min(c0, c1);
    const large = Math.max(c0, c1);

    // If the line doesn't show a clear bimodal distribution, be conservative.
    const separation = large - small;
    const ratio = small > 0 ? large / small : large;
    if (separation < 0.12 || ratio < 1.5) {
      // If median gaps are reasonably large, treat as word-tokenized.
      if (p50 >= 0.42) {
        return Math.max(0.28, Math.min(0.95, p50 * 0.9));
      }
      // Otherwise require a very clear gap (prevents intra-word breaks).
      return Math.max(0.95, Math.min(1.6, p90 * 1.15));
    }

    const threshold = (small + large) / 2;
    // Guard against thresholds that would split typical intra-word glyph gaps.
    const guarded = Math.max(threshold, p75 * 0.9);
    return Math.max(0.5, Math.min(1.35, guarded));
  }

  private kMeans2(values: number[]): { c0: number; c1: number } {
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

  private isUrlStart(s: string): boolean {
    return /^(https?:\/\/|https?:|www\.)/i.test(s);
  }

  private isInUrlContext(prevText: string, nextText: string): boolean {
    const prev = prevText.toLowerCase();
    const next = nextText.toLowerCase();
    if (/(https?:\/\/|www\.)/.test(prev) || /(https?:\/\/|www\.)/.test(next)) return true;
    if (/:\/\//.test(prev) || /:\/\//.test(next)) return true;
    if (prev.includes('/') || next.startsWith('/')) return true;

    if (/\.$/.test(prevText) && /^[A-Za-z0-9-]{2,}$/.test(nextText)) return true;
    if (/\.[A-Za-z]{2,4}$/.test(prevText)) return true;
    if (/^[A-Za-z]{2,4}$/.test(nextText) && /\.$/.test(prevText) && prevText.length >= 4) return true;
    return false;
  }

  // Heuristic helpers removed intentionally in favor of geometry-first clustering.
 }
