import type {
  BoundaryClassifier,
  BoundaryClassifierContext,
  BoundaryDecision,
  LineGeometryModel,
  NormalizedGlyphItem
} from './types.js';

export class RuleBoundaryClassifier implements BoundaryClassifier {
  classify(
    prev: NormalizedGlyphItem,
    next: NormalizedGlyphItem,
    model: LineGeometryModel,
    ctx: BoundaryClassifierContext
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

    if (ctx.profile.joinCjk && ctx.resolvedScript === 'cjk') {
      if (isCjkText(prevText) && isCjkText(nextText)) {
        return {
          type: 'join',
          confidence: 0.95,
          gapPx,
          gapByChar,
          thresholdByChar: model.wordBreakThresholdByChar
        };
      }
    }

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

    const alphaToAlpha = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
    const singleLetterAlpha = alphaToAlpha && (/^[A-Za-z]$/.test(prevText) || /^[A-Za-z]$/.test(nextText));
    if (singleLetterAlpha) {
      const minSplit = Math.max(model.wordBreakThresholdByChar * 1.35, 1.25);
      if (gapByChar < minSplit) {
        return {
          type: 'join',
          confidence: 0.9,
          gapPx,
          gapByChar,
          thresholdByChar: minSplit
        };
      }
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

    const splitLowerUpper = ctx.profile.splitLowerUpper === true;
    if (splitLowerUpper) {
      const prevEndsLower = /[a-z]$/.test(prevText);
      const nextStartsUpper = /^[A-Z]/.test(nextText);
      const prevIsSinglePrefix = /^[ei]$/.test(prevText);
      const alphaLike = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);

      if (alphaLike && prevEndsLower && nextStartsUpper && !prevIsSinglePrefix) {
        const minSplit = Math.min(0.35, Math.max(0.18, model.wordBreakThresholdByChar * 0.55));
        if (gapByChar >= minSplit) {
          return {
            type: 'space',
            confidence: 0.7,
            gapPx,
            gapByChar,
            thresholdByChar: minSplit
          };
        }
      }
    }

    const splitAllCaps = ctx.profile.splitAllCaps === true;
    if (splitAllCaps) {
      const prevAllCaps = /^[A-Z0-9]{3,}$/.test(prevText);
      const nextAllCaps = /^[A-Z0-9]{3,}$/.test(nextText);
      if (prevAllCaps && nextAllCaps) {
        const minSplit = Math.min(0.45, Math.max(0.2, model.wordBreakThresholdByChar * 0.6));
        if (gapByChar >= minSplit) {
          return {
            type: 'space',
            confidence: 0.75,
            gapPx,
            gapByChar,
            thresholdByChar: minSplit
          };
        }
      }
    }

    const scale = typeof ctx.profile.wordBreakThresholdScale === 'number' && Number.isFinite(ctx.profile.wordBreakThresholdScale)
      ? ctx.profile.wordBreakThresholdScale
      : 1;

    let threshold = model.wordBreakThresholdByChar * Math.max(0.25, Math.min(3, scale));

    const digitToDigit = /[0-9]$/.test(prevText) && /^[0-9]/.test(nextText);
    if (digitToDigit) {
      const minDigitThreshold = typeof ctx.profile.digitWordBreakThresholdMin === 'number' && Number.isFinite(ctx.profile.digitWordBreakThresholdMin)
        ? ctx.profile.digitWordBreakThresholdMin
        : 1.35;
      threshold = Math.max(threshold, minDigitThreshold);
    }

    const splitDigitAlpha = ctx.profile.splitDigitAlpha === true;
    if (splitDigitAlpha) {
      const digitToAlpha = /[0-9]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
      const alphaToDigit = /[A-Za-z]$/.test(prevText) && /^[0-9]/.test(nextText);
      if (digitToAlpha || alphaToDigit) {
        const minSplit = Math.min(0.4, Math.max(0.16, threshold * 0.55));
        if (gapByChar >= minSplit) {
          return {
            type: 'space',
            confidence: 0.7,
            gapPx,
            gapByChar,
            thresholdByChar: minSplit
          };
        }
      }
    }

    if (/[:;,]$/.test(prevText) && /^[A-Za-z0-9]/.test(nextText)) {
      threshold = /:$/.test(prevText) && /^\d/.test(nextText) ? threshold : Math.min(threshold, 0.28);
    }

    const multiToken = prevText.length >= 2 && nextText.length >= 2;
    const alphaLike = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
    if (multiToken && alphaLike && prevText.length >= 3 && nextText.length >= 3) {
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

function isCjkText(t: string): boolean {
  if (!t) return false;
  for (let i = 0; i < t.length; i++) {
    const cp = t.codePointAt(i);
    if (cp === undefined) continue;
    if (
      (cp >= 0x4e00 && cp <= 0x9fff) ||
      (cp >= 0x3400 && cp <= 0x4dbf) ||
      (cp >= 0x3040 && cp <= 0x30ff) ||
      (cp >= 0x31f0 && cp <= 0x31ff) ||
      (cp >= 0xac00 && cp <= 0xd7af)
    ) {
      if (cp > 0xffff) i++;
      continue;
    }
    return false;
  }
  return true;
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
