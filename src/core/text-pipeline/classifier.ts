import type { BoundaryDecision, LineGeometryModel, NormalizedGlyphItem } from './types.js';

export function classifyBoundary(
  prev: NormalizedGlyphItem,
  next: NormalizedGlyphItem,
  model: LineGeometryModel
): BoundaryDecision {
  const prevText = (prev.text || '').trim();
  const nextText = (next.text || '').trim();

  const rawGap = next.x - (prev.x + prev.width);
  const avgFontSize = Math.max(1, (prev.fontSize + next.fontSize) / 2);
  const tolerance = avgFontSize * 0.25;
  const gapPx = rawGap < 0 && rawGap >= -tolerance ? 0 : rawGap;
  if (gapPx < 0) {
    return {
      type: 'join',
      confidence: 0.9,
      gapPx,
      gapByChar: 0,
      thresholdByChar: model.wordBreakThresholdByChar
    };
  }

  const gapByChar = gapPx / Math.max(0.01, model.estimatedCharWidth);

  const timeLike = /\d:$/.test(prevText) && /^\d/.test(nextText);
  if (timeLike) {
    return {
      type: 'join',
      confidence: 0.95,
      gapPx,
      gapByChar,
      thresholdByChar: model.wordBreakThresholdByChar
    };
  }

  const inUrl = isInUrlContext(prevText, nextText);
  if (inUrl) {
    return {
      type: 'join',
      confidence: 0.95,
      gapPx,
      gapByChar,
      thresholdByChar: model.wordBreakThresholdByChar
    };
  }

  if (/^[,.;:!?)]/.test(nextText)) {
    return {
      type: 'join',
      confidence: 0.95,
      gapPx,
      gapByChar,
      thresholdByChar: model.wordBreakThresholdByChar
    };
  }

  let threshold = model.wordBreakThresholdByChar;

  const digitToDigit = /[0-9]$/.test(prevText) && /^[0-9]/.test(nextText);
  if (digitToDigit) threshold = Math.max(threshold, 1.35);

  if (/[:;,]$/.test(prevText) && /^[A-Za-z0-9]/.test(nextText)) {
    threshold = /:$/.test(prevText) && /^\d/.test(nextText) ? threshold : Math.min(threshold, 0.28);
  }

  const multiToken = prevText.length >= 2 && nextText.length >= 2;
  const alphaLike = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
  if (multiToken && alphaLike) {
    threshold = Math.min(threshold, 0.32);
  }

  const space = gapByChar >= threshold;

  const margin = Math.min(1.5, Math.abs(gapByChar - threshold));
  const confidence = clamp01(0.55 + margin / 1.5);

  return {
    type: space ? 'space' : 'join',
    confidence,
    gapPx,
    gapByChar,
    thresholdByChar: threshold
  };
}

function isInUrlContext(prevText: string, nextText: string): boolean {
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

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
