/**
 * Unified Boundary Detector
 * 
 * This module consolidates all boundary detection logic into a single facade.
 * It provides a unified API for detecting word boundaries in PDF text extraction,
 * combining:
 * - Geometric gap analysis (from space-detector)
 * - Linguistic analysis (from word-validator and predictive-model)
 * - Smart classification (from smart-boundary-classifier)
 * - Post-processing fixes (from word-validator.fixMergedText)
 */

import type { PDFTextContent } from '../../types/pdf.js';
import { getDefaultWordValidator, type WordValidator } from './word-validator.js';
import { getDefaultPredictiveModel, type PredictiveTextModel } from './predictive-model.js';

export interface BoundaryDetectionResult {
  shouldInsertSpace: boolean;
  confidence: number;
  gapPx: number;
  gapRatio: number;
  threshold: number;
  reason: string;
}

export interface UnifiedBoundaryConfig {
  /** Minimum gap ratio for multi-token alphabetic sequences */
  multiTokenAlphaThreshold: number;
  /** Minimum gap ratio for case boundary detection (lower->Upper) */
  caseBoundaryThreshold: number;
  /** Minimum gap ratio for general word breaks */
  generalThreshold: number;
  /** Whether to use linguistic analysis */
  useLinguisticAnalysis: boolean;
  /** Whether to apply post-processing fixes */
  applyPostProcessing: boolean;
}

const DEFAULT_CONFIG: UnifiedBoundaryConfig = {
  multiTokenAlphaThreshold: 0.15,
  caseBoundaryThreshold: 0.08,
  generalThreshold: 0.85,
  useLinguisticAnalysis: true,
  applyPostProcessing: true
};

/**
 * Unified Boundary Detector
 * 
 * Single source of truth for all word boundary detection in the PDF2HTML library.
 */
export class UnifiedBoundaryDetector {
  private wordValidator: WordValidator;
  private predictiveModel: PredictiveTextModel;
  private config: UnifiedBoundaryConfig;

  constructor(config: Partial<UnifiedBoundaryConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.wordValidator = getDefaultWordValidator();
    this.predictiveModel = getDefaultPredictiveModel();
  }

  /**
   * Determine if a space should be inserted between two text items.
   */
  shouldInsertSpace(
    prev: PDFTextContent,
    next: PDFTextContent,
    estimatedCharWidth?: number
  ): BoundaryDetectionResult {
    const prevText = (prev.text || '').trim();
    const nextText = (next.text || '').trim();

    // Calculate gap metrics
    const rawGap = next.x - (prev.x + prev.width);
    const avgFontSize = Math.max(1, (prev.fontSize + next.fontSize) / 2);
    const tolerance = avgFontSize * 0.25;
    const gapPx = rawGap < 0 && rawGap >= -tolerance ? 0 : rawGap;

    // Estimate character width if not provided
    const charWidth = estimatedCharWidth ?? this.estimateCharWidth(prev, next, avgFontSize);
    const gapRatio = gapPx / Math.max(0.01, charWidth);

    // Negative gap - definitely overlap, no space
    if (gapPx < 0) {
      return this.makeResult(false, 0.95, gapPx, gapRatio, 0, 'negative_gap');
    }

    // Very large gap - definitely a space
    if (gapRatio >= 2.0) {
      return this.makeResult(true, 0.95, gapPx, gapRatio, 2.0, 'large_gap');
    }

    // URL context - no spaces inside URLs
    if (this.isInUrlContext(prevText, nextText)) {
      return this.makeResult(false, 0.9, gapPx, gapRatio, 2.0, 'url_context');
    }

    // Email context - no spaces inside emails
    if (this.isEmailContext(prevText, nextText)) {
      return this.makeResult(false, 0.9, gapPx, gapRatio, 2.0, 'email_context');
    }

    // Punctuation attachment
    if (/^[,.;:!?)\]}"']+$/.test(nextText)) {
      return this.makeResult(false, 0.95, gapPx, gapRatio, 2.0, 'punctuation_attach');
    }

    // Opening punctuation - join with following
    if (/^[([{"']+$/.test(prevText)) {
      return this.makeResult(false, 0.9, gapPx, gapRatio, 2.0, 'opening_punct');
    }

    // Time patterns (12:30)
    if (/\d:$/.test(prevText) && /^\d/.test(nextText)) {
      return this.makeResult(false, 0.95, gapPx, gapRatio, 2.0, 'time_pattern');
    }

    // Single character handling - be conservative
    const singleToSingle = prevText.length === 1 && nextText.length === 1;
    if (singleToSingle && /^[A-Za-z0-9]$/.test(prevText) && /^[A-Za-z0-9]$/.test(nextText)) {
      const threshold = Math.max(this.config.generalThreshold, 2.2);
      return this.makeResult(gapRatio >= threshold, 0.8, gapPx, gapRatio, threshold, 'single_char');
    }

    // Digit sequences - keep together
    const digitToDigit = /[0-9]$/.test(prevText) && /^[0-9]/.test(nextText);
    if (digitToDigit) {
      const threshold = Math.max(this.config.generalThreshold, 1.35);
      return this.makeResult(gapRatio >= threshold, 0.85, gapPx, gapRatio, threshold, 'digit_sequence');
    }

    // Multi-token alphabetic sequences - use lower threshold
    const multiToken = prevText.length >= 3 && nextText.length >= 3;
    const alphaToAlpha = /[A-Za-z]$/.test(prevText) && /^[A-Za-z]/.test(nextText);

    if (multiToken && alphaToAlpha) {
      let threshold = this.config.multiTokenAlphaThreshold;

      // Case boundary detection (lowercase -> Uppercase)
      const caseBoundary = /[a-z]$/.test(prevText) && /^[A-Z]/.test(nextText);
      if (caseBoundary) {
        threshold = Math.min(threshold, this.config.caseBoundaryThreshold);
      }

      // Use linguistic analysis if enabled
      if (this.config.useLinguisticAnalysis) {
        const joined = prevText + nextText;
        const joinedLower = joined.toLowerCase();

        // If joined is a valid word, don't split
        if (this.wordValidator.isWord(joinedLower)) {
          return this.makeResult(false, 0.9, gapPx, gapRatio, threshold, 'valid_word');
        }

        // If both parts are valid words, prefer splitting
        const prevLower = prevText.toLowerCase();
        const nextLower = nextText.toLowerCase();
        if (this.wordValidator.isWord(prevLower) && this.wordValidator.isWord(nextLower)) {
          threshold = Math.min(threshold, 0.1);
        }
      }

      return this.makeResult(gapRatio >= threshold, 0.85, gapPx, gapRatio, threshold, 'multi_token_alpha');
    }

    // Short alpha pairs - be more conservative
    const shortAlphaPair = prevText.length <= 3 && nextText.length <= 3 && alphaToAlpha;
    if (shortAlphaPair) {
      const threshold = Math.max(this.config.generalThreshold, 1.85);
      return this.makeResult(gapRatio >= threshold, 0.75, gapPx, gapRatio, threshold, 'short_alpha_pair');
    }

    // After separators (comma, semicolon, colon)
    if (/[:;,]$/.test(prevText) && /^[A-Za-z0-9]/.test(nextText)) {
      const threshold = 0.28;
      return this.makeResult(gapRatio >= threshold, 0.8, gapPx, gapRatio, threshold, 'after_separator');
    }

    // Default: use general threshold
    return this.makeResult(
      gapRatio >= this.config.generalThreshold,
      0.7,
      gapPx,
      gapRatio,
      this.config.generalThreshold,
      'default'
    );
  }

  /**
   * Fix merged words in text using dictionary-based splitting.
   * E.g., "connectingfinance" -> "connecting finance"
   */
  fixMergedText(text: string): string {
    if (!this.config.applyPostProcessing) return text;
    return this.wordValidator.fixMergedText(text);
  }

  /**
   * Split a merged word into separate words if possible.
   */
  splitMergedWords(text: string): string {
    return this.wordValidator.splitMergedWords(text);
  }

  /**
   * Check if text is a valid word.
   */
  isValidWord(text: string): boolean {
    return this.wordValidator.isWord(text.toLowerCase());
  }

  /**
   * Get the word validator instance.
   */
  getWordValidator(): WordValidator {
    return this.wordValidator;
  }

  /**
   * Get the predictive model instance.
   */
  getPredictiveModel(): PredictiveTextModel {
    return this.predictiveModel;
  }

  private estimateCharWidth(prev: PDFTextContent, next: PDFTextContent, avgFontSize: number): number {
    const prevText = (prev.text || '').replace(/\s+/g, '');
    const nextText = (next.text || '').replace(/\s+/g, '');
    const prevLen = prevText.length;
    const nextLen = nextText.length;

    if (prevLen > 0 && prev.width > 0) {
      return prev.width / prevLen;
    }
    if (nextLen > 0 && next.width > 0) {
      return next.width / nextLen;
    }
    return avgFontSize * 0.5;
  }

  private isInUrlContext(prevText: string, nextText: string): boolean {
    const prev = prevText.toLowerCase();
    const next = nextText.toLowerCase();
    if (/(https?:\/\/|www\.)/.test(prev) || /(https?:\/\/|www\.)/.test(next)) return true;
    if (/:\/\//.test(prev) || /:\/\//.test(next)) return true;
    if (prev.includes('/') && /^[A-Za-z0-9-]/.test(next)) return true;
    if (/\.[A-Za-z]{2,4}$/.test(prevText) && /^[A-Za-z0-9/]/.test(nextText)) return true;
    return false;
  }

  private isEmailContext(prevText: string, nextText: string): boolean {
    if (prevText.includes('@') || nextText.includes('@')) return true;
    if (prevText.endsWith('@') || nextText.startsWith('@')) return true;
    // Check for email-like patterns
    if (/^[A-Za-z0-9._%+-]+$/.test(prevText) && /^[A-Za-z0-9._%+-]+$/.test(nextText)) {
      if (prevText.includes('.') || nextText.includes('.')) return true;
    }
    return false;
  }

  private makeResult(
    shouldInsertSpace: boolean,
    confidence: number,
    gapPx: number,
    gapRatio: number,
    threshold: number,
    reason: string
  ): BoundaryDetectionResult {
    return { shouldInsertSpace, confidence, gapPx, gapRatio, threshold, reason };
  }
}

// Singleton instance
let _defaultDetector: UnifiedBoundaryDetector | null = null;

export function getDefaultBoundaryDetector(): UnifiedBoundaryDetector {
  if (!_defaultDetector) {
    _defaultDetector = new UnifiedBoundaryDetector();
  }
  return _defaultDetector;
}

export function createBoundaryDetector(config?: Partial<UnifiedBoundaryConfig>): UnifiedBoundaryDetector {
  return new UnifiedBoundaryDetector(config);
}
