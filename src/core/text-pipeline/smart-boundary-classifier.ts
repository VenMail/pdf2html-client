/**
 * Smart Boundary Classifier
 * 
 * Enhanced boundary classifier that combines geometric heuristics
 * with linguistic intelligence from the predictive model and word validator.
 */

import type {
  BoundaryClassifier,
  BoundaryClassifierContext,
  BoundaryDecision,
  LineGeometryModel,
  NormalizedGlyphItem
} from './types.js';
import { getDefaultPredictiveModel } from './predictive-model.js';
import { getDefaultWordValidator } from './word-validator.js';

/**
 * Accumulated context for multi-character boundary decisions
 */
interface AccumulatedContext {
  prevWord: string;           // Word accumulated so far on the left
  prevGlyphs: NormalizedGlyphItem[];  // Previous glyphs in current word
}

/**
 * Smart Boundary Classifier
 * 
 * This classifier enhances the rule-based approach with:
 * 1. N-gram based boundary prediction
 * 2. Dictionary-based word validation
 * 3. Proper noun and capitalization pattern handling
 */
export class SmartBoundaryClassifier implements BoundaryClassifier {
  private predictiveModel = getDefaultPredictiveModel();
  private wordValidator = getDefaultWordValidator();
  private accumulated: AccumulatedContext = { prevWord: '', prevGlyphs: [] };

  /**
   * Reset accumulated context (call at start of new line)
   */
  resetContext(): void {
    this.accumulated = { prevWord: '', prevGlyphs: [] };
  }

  /**
   * Update accumulated context after a join decision
   */
  private updateAccumulatedJoin(glyph: NormalizedGlyphItem): void {
    this.accumulated.prevWord += glyph.text;
    this.accumulated.prevGlyphs.push(glyph);
  }

  /**
   * Update accumulated context after a space decision
   */
  private updateAccumulatedSpace(glyph: NormalizedGlyphItem): void {
    this.accumulated.prevWord = glyph.text;
    this.accumulated.prevGlyphs = [glyph];
  }

  classify(
    prev: NormalizedGlyphItem,
    next: NormalizedGlyphItem,
    model: LineGeometryModel,
    ctx: BoundaryClassifierContext
  ): BoundaryDecision {
    const prevText = (prev.text || '').trim();
    const nextText = (next.text || '').trim();

    // Calculate gap metrics
    const rawGap = next.x - (prev.x + prev.width);
    const avgFontSize = Math.max(1, (prev.fontSize + next.fontSize) / 2);
    const tolerance = avgFontSize * 0.25;
    const gapPx = rawGap < 0 && rawGap >= -tolerance ? 0 : rawGap;
    const gapByChar = gapPx / Math.max(0.01, model.estimatedCharWidth);

    // === PHASE 1: Hard rules (definite decisions) ===

    // Negative gap - definitely overlap, join
    if (gapPx < 0) {
      this.updateAccumulatedJoin(next);
      return this.makeDecision('join', 0.95, gapPx, gapByChar, model.wordBreakThresholdByChar);
    }

    // Very large gap - definitely a space
    if (gapByChar >= 2.0) {
      this.updateAccumulatedSpace(next);
      return this.makeDecision('space', 0.95, gapPx, gapByChar, model.wordBreakThresholdByChar);
    }

    // CJK text - always join (no spaces in CJK)
    if (ctx.profile.joinCjk && ctx.resolvedScript === 'cjk') {
      if (this.isCjkText(prevText) && this.isCjkText(nextText)) {
        this.updateAccumulatedJoin(next);
        return this.makeDecision('join', 0.95, gapPx, gapByChar, model.wordBreakThresholdByChar);
      }
    }

    // Time-like patterns (12:30)
    if (/\d:$/.test(prevText) && /^\d/.test(nextText)) {
      this.updateAccumulatedJoin(next);
      return this.makeDecision('join', 0.95, gapPx, gapByChar, model.wordBreakThresholdByChar);
    }

    // URL context
    if (this.isInUrlContext(prevText, nextText)) {
      this.updateAccumulatedJoin(next);
      return this.makeDecision('join', 0.95, gapPx, gapByChar, model.wordBreakThresholdByChar);
    }

    // Punctuation attachment
    if (/^[,.;:!?)\]}"']+$/.test(nextText)) {
      this.updateAccumulatedJoin(next);
      return this.makeDecision('join', 0.95, gapPx, gapByChar, model.wordBreakThresholdByChar);
    }

    // Opening punctuation - join with following
    if (/^[([{"']+$/.test(prevText)) {
      this.updateAccumulatedJoin(next);
      return this.makeDecision('join', 0.90, gapPx, gapByChar, model.wordBreakThresholdByChar);
    }

    // === PHASE 2: Linguistic analysis ===

    const accumulatedWord = this.accumulated.prevWord + prevText;
    const alphaToAlpha = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);

    if (alphaToAlpha) {
      const prevAllCaps = /^[A-Z]{2,}$/.test(prevText);
      const nextAllCaps = /^[A-Z]{2,}$/.test(nextText);
      if (prevAllCaps && nextAllCaps) {
        const combinedLen = prevText.length + nextText.length;
        const hasShortToken = prevText.length <= 3 || nextText.length <= 3;
        const joinThreshold = hasShortToken
          ? Math.max(0.85, model.wordBreakThresholdByChar * 1.25)
          : Math.max(0.35, model.wordBreakThresholdByChar * 0.8);
        if (combinedLen <= 16 && gapByChar < joinThreshold) {
          this.updateAccumulatedJoin(next);
          return this.makeDecision('join', 0.85, gapPx, gapByChar, joinThreshold);
        }
      }

      // Check if joining would form a valid word
      const joined = accumulatedWord + nextText;
      const joinScore = this.wordValidator.scoreJoin(accumulatedWord, nextText);

      // Use predictive model for boundary decision
      const prediction = this.predictiveModel.predict({
        prevChars: prevText.slice(-3),
        nextChars: nextText.slice(0, 3),
        accumulatedWord,
        gapRatio: gapByChar,
        currentChar: prevText.slice(-1),
        nextChar: nextText.slice(0, 1)
      });

      // Strong linguistic signal to join (forms valid word)
      if (joinScore >= 0.8 && this.wordValidator.isWord(joined.toLowerCase())) {
        this.updateAccumulatedJoin(next);
        return this.makeDecision('join', 0.9, gapPx, gapByChar, model.wordBreakThresholdByChar);
      }

      // Strong linguistic signal to split (both are valid words/prefixes)
      if (joinScore <= 0.35) {
        const leftValid = this.wordValidator.isWord(accumulatedWord.toLowerCase()) || 
                          this.wordValidator.isPrefix(accumulatedWord.toLowerCase());
        const rightValid = this.wordValidator.isPrefix(nextText.toLowerCase());
        
        if (leftValid && rightValid && gapByChar >= 0.15) {
          this.updateAccumulatedSpace(next);
          return this.makeDecision('space', 0.8, gapPx, gapByChar, Math.max(0.15, model.wordBreakThresholdByChar * 0.5));
        }
      }

      // Capitalization boundary (lowercase to uppercase)
      const prevEndsLower = /[a-z]$/.test(prevText);
      const nextStartsUpper = /^[A-Z]/.test(nextText);
      
      if (prevEndsLower && nextStartsUpper) {
        // Check if it's a camelCase situation (e.g., "iPhone", "eBay")
        const isCamelCase = accumulatedWord.length <= 2 && /^[a-z]+$/.test(accumulatedWord);
        
        if (!isCamelCase && gapByChar >= 0.1) {
          // Likely a proper noun boundary like "JohnSmith" -> "John Smith"
          if (accumulatedWord.length >= 3 || prediction.shouldBreak) {
            this.updateAccumulatedSpace(next);
            return this.makeDecision('space', prediction.confidence, gapPx, gapByChar, 0.1);
          }
        }
      }

      // Use predictive model decision if confident
      if (prediction.confidence >= 0.75) {
        if (prediction.shouldBreak) {
          this.updateAccumulatedSpace(next);
        } else {
          this.updateAccumulatedJoin(next);
        }
        return this.makeDecision(
          prediction.shouldBreak ? 'space' : 'join',
          prediction.confidence,
          gapPx,
          gapByChar,
          model.wordBreakThresholdByChar
        );
      }
    }

    // === PHASE 3: Single letter handling ===

    const singleLetterAlpha = alphaToAlpha && 
      (/^[A-Za-z]$/.test(prevText) || /^[A-Za-z]$/.test(nextText));
    
    if (singleLetterAlpha) {
      // Single letters should generally join unless gap is large
      const minSplit = Math.max(model.wordBreakThresholdByChar * 1.5, 1.5);
      if (gapByChar < minSplit) {
        this.updateAccumulatedJoin(next);
        return this.makeDecision('join', 0.85, gapPx, gapByChar, minSplit);
      }
    }

    // === PHASE 4: Digit handling ===

    const digitToDigit = /[0-9]$/.test(prevText) && /^[0-9]/.test(nextText);
    if (digitToDigit) {
      // Digits usually stay together (phone numbers, IDs, etc.)
      const minSplit = Math.max(model.wordBreakThresholdByChar, 1.5);
      if (gapByChar < minSplit) {
        this.updateAccumulatedJoin(next);
        return this.makeDecision('join', 0.85, gapPx, gapByChar, minSplit);
      }
    }

    // Digit-alpha transitions
    const digitToAlpha = /[0-9]$/.test(prevText) && /^[A-Za-z]/.test(nextText);
    const alphaToDigit = /[A-Za-z]$/.test(prevText) && /^[0-9]/.test(nextText);
    
    if ((digitToAlpha || alphaToDigit) && ctx.profile.splitDigitAlpha) {
      const minSplit = Math.max(0.2, model.wordBreakThresholdByChar * 0.6);
      if (gapByChar >= minSplit) {
        this.updateAccumulatedSpace(next);
        return this.makeDecision('space', 0.7, gapPx, gapByChar, minSplit);
      }
    }

    // === PHASE 5: Final geometric decision ===

    // Apply profile scaling
    const scale = typeof ctx.profile.wordBreakThresholdScale === 'number' && 
                  Number.isFinite(ctx.profile.wordBreakThresholdScale)
      ? ctx.profile.wordBreakThresholdScale
      : 1;

    let threshold = model.wordBreakThresholdByChar * Math.max(0.25, Math.min(3, scale));

    // Multi-character tokens with moderate gap likely need space
    if (prevText.length >= 3 && nextText.length >= 3 && alphaToAlpha) {
      threshold = Math.min(threshold, 0.35);
    }

    // After separators like comma, semicolon
    if (/[:;,]$/.test(prevText) && /^[A-Za-z0-9]/.test(nextText)) {
      if (!(/:\s*$/.test(prevText) && /^\d/.test(nextText))) { // Not time-like
        threshold = Math.min(threshold, 0.3);
      }
    }

    const space = gapByChar >= threshold;
    const margin = Math.min(1.5, Math.abs(gapByChar - threshold));
    const confidence = this.clamp01(0.55 + margin / 1.5);

    if (space) {
      this.updateAccumulatedSpace(next);
    } else {
      this.updateAccumulatedJoin(next);
    }

    return this.makeDecision(space ? 'space' : 'join', confidence, gapPx, gapByChar, threshold);
  }

  private makeDecision(
    type: 'space' | 'join',
    confidence: number,
    gapPx: number,
    gapByChar: number,
    thresholdByChar: number
  ): BoundaryDecision {
    return { type, confidence, gapPx, gapByChar, thresholdByChar };
  }

  private isInUrlContext(prevText: string, nextText: string): boolean {
    const prev = prevText.toLowerCase();
    const next = nextText.toLowerCase();
    if (/(https?:\/\/|www\.)/.test(prev) || /(https?:\/\/|www\.)/.test(next)) return true;
    if (/:\/\//.test(prev) || /:\/\//.test(next)) return true;
    if (prev.includes('/') || next.startsWith('/')) return true;
    if (/\.$/.test(prevText) && /^[A-Za-z0-9-]{2,}$/.test(nextText)) return true;
    if (/\.[A-Za-z]{2,4}$/.test(prevText)) return true;
    return false;
  }

  private isCjkText(t: string): boolean {
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

  private clamp01(v: number): number {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    return v;
  }
}

// Factory function
export function createSmartBoundaryClassifier(): SmartBoundaryClassifier {
  return new SmartBoundaryClassifier();
}
