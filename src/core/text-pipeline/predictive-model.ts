/**
 * Predictive Text Model - N-gram based boundary prediction
 * 
 * Uses character bigram/trigram probabilities and linguistic patterns
 * to predict word boundaries when geometric heuristics are uncertain.
 */

/**
 * Character context for boundary prediction
 */
export interface CharacterContext {
  prevChars: string;        // Previous characters (up to 3)
  nextChars: string;        // Next characters (lookahead, up to 3)
  accumulatedWord: string;  // Word accumulated so far
  gapRatio: number;         // Gap / estimated char width
  currentChar: string;      // The character at the boundary
  nextChar: string;         // The next character
}

/**
 * Boundary prediction result
 */
export interface BoundaryPrediction {
  shouldBreak: boolean;
  confidence: number;
  reason: 'geometric' | 'linguistic' | 'pattern' | 'dictionary' | 'capitalization';
}

/**
 * English character bigram probabilities (log probabilities)
 * Higher values = more likely to appear together (no space between)
 * 
 * These are derived from English text corpus analysis.
 * Format: 'XY' where X is the ending char and Y is the starting char
 */
const BIGRAM_JOIN_SCORES: Record<string, number> = {
  // Very common within-word transitions (high join score)
  'th': 0.95, 'he': 0.94, 'in': 0.93, 'er': 0.93, 'an': 0.92,
  'en': 0.91, 'on': 0.91, 'at': 0.90, 'es': 0.90, 'ed': 0.90,
  're': 0.89, 'nt': 0.89, 'ti': 0.89, 'or': 0.88, 'te': 0.88,
  'is': 0.88, 'it': 0.87, 'al': 0.87, 'ar': 0.87, 'st': 0.87,
  'nd': 0.86, 'ng': 0.86, 'to': 0.85, 'le': 0.85, 'se': 0.85,
  'of': 0.84, 'ha': 0.84, 've': 0.84, 'ou': 0.84, 'hi': 0.83,
  'as': 0.83, 'me': 0.83, 'fo': 0.82, 'wa': 0.82, 'ec': 0.82,
  'ne': 0.81, 'be': 0.81, 'de': 0.81, 'wi': 0.80, 'no': 0.80,
  'co': 0.80, 'ca': 0.79, 'ma': 0.79, 'li': 0.79, 'ri': 0.78,
  'si': 0.78, 'so': 0.78, 'ea': 0.77, 'io': 0.77, 'ce': 0.77,
  'pe': 0.76, 'ro': 0.76, 'us': 0.76, 'el': 0.75, 'la': 0.75,
  'di': 0.75, 'ra': 0.74, 'll': 0.74, 'ur': 0.74, 'ta': 0.73,
  'ho': 0.73, 'lo': 0.73, 'ut': 0.72, 'ch': 0.72, 'ge': 0.72,
  'pr': 0.71, 'po': 0.71, 'om': 0.70, 'mo': 0.70,
  'un': 0.70, 'ex': 0.70, 'tr': 0.69, 'ac': 0.69, 'pa': 0.69,
  'ss': 0.68, 'sh': 0.68, 'wh': 0.68, 'ad': 0.67, 'sp': 0.67,
  'ct': 0.67, 'do': 0.66, 'ic': 0.66, 'ab': 0.66, 'ye': 0.65,
  'ay': 0.65, 'oo': 0.65, 'ev': 0.64, 'ee': 0.64, 'id': 0.64,
  'em': 0.63, 'ag': 0.63, 'ke': 0.63, 'ob': 0.62, 'am': 0.62,
  'fe': 0.62, 'go': 0.61, 'ld': 0.61, 'op': 0.61, 'up': 0.60,
  'ck': 0.60, 'bu': 0.60, 'ap': 0.59, 'bo': 0.59, 'im': 0.59,
  'pl': 0.58, 'wo': 0.58, 'gu': 0.58, 'cl': 0.57, 'tu': 0.57,
  'ff': 0.56, 'gr': 0.56, 'uc': 0.56, 'sc': 0.55, 'bl': 0.55,
  'su': 0.55, 'qu': 0.54, 'dr': 0.54, 'ru': 0.54, 'ry': 0.53,
  'ly': 0.53, 'ty': 0.52, 'pp': 0.52, 'iv': 0.52, 'ep': 0.51,
  'br': 0.51, 'fr': 0.50, 'cr': 0.50, 'fl': 0.49, 'gl': 0.49,
  'sl': 0.48, 'sw': 0.48, 'tw': 0.47, 'sk': 0.47, 'sm': 0.46,
  'sn': 0.45, 'wr': 0.44, 'kn': 0.43, 'gn': 0.42, 'ps': 0.41,
  
  // Medium transitions
  'ey': 0.55, 'oy': 0.54, 'aw': 0.53, 'ew': 0.52,
  
  // Less common but valid
  'xi': 0.40, 'xp': 0.40, 'xa': 0.39, 'xe': 0.38,
  'ze': 0.38, 'za': 0.37, 'zo': 0.36, 'ow': 0.51,
  
  // Vowel-vowel (often word boundaries but not always)
  'ae': 0.35, 'ai': 0.50, 'ao': 0.30, 'au': 0.45,
  'ei': 0.45, 'ia': 0.45,
  'oa': 0.40,
  'oi': 0.45, 'ua': 0.40, 'ue': 0.45, 'ui': 0.45, 'uo': 0.30,
};

/**
 * Common English word prefixes (high probability of NOT being a word boundary after)
 */
const COMMON_PREFIXES = new Set([
  'un', 're', 'in', 'dis', 'en', 'em', 'non', 'pre', 'pro', 'anti',
  'auto', 'bi', 'co', 'de', 'ex', 'extra', 'hyper', 'inter', 'intra',
  'macro', 'micro', 'mid', 'mis', 'mono', 'multi', 'out', 'over', 'poly',
  'post', 'semi', 'sub', 'super', 'trans', 'tri', 'ultra', 'under',
]);

/**
 * Common English word suffixes (high probability of word boundary AFTER)
 */
const COMMON_SUFFIXES = new Set([
  'able', 'ible', 'al', 'ial', 'ed', 'en', 'er', 'est', 'ful', 'ic',
  'ing', 'ion', 'tion', 'ation', 'ition', 'ity', 'ty', 'ive', 'ative',
  'itive', 'less', 'ly', 'ment', 'ness', 'ous', 'eous', 'ious', 's', 'es',
  'y', 'ry', 'ery', 'ory', 'ary',
]);

/**
 * Predictive Text Model
 * 
 * Uses n-gram statistics and linguistic patterns to predict
 * whether a boundary between characters should be a space or not.
 */
export class PredictiveTextModel {
  
  /**
   * Get bigram join score (probability that two chars are within the same word)
   */
  private getBigramScore(char1: string, char2: string): number {
    const bigram = (char1 + char2).toLowerCase();
    return BIGRAM_JOIN_SCORES[bigram] ?? 0.4; // Default moderate score
  }

  /**
   * Check if accumulated text ends with a common suffix
   */
  private endsWithSuffix(text: string): boolean {
    const lower = text.toLowerCase();
    for (const suffix of COMMON_SUFFIXES) {
      if (lower.endsWith(suffix) && lower.length > suffix.length) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if text starts with a common prefix
   */
  private startsWithPrefix(text: string): boolean {
    const lower = text.toLowerCase();
    for (const prefix of COMMON_PREFIXES) {
      if (lower.startsWith(prefix)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check for capitalization patterns that suggest boundaries
   */
  private checkCapitalizationBoundary(prevChar: string, nextChar: string): boolean {
    // Lowercase to uppercase usually indicates a boundary
    if (/[a-z]/.test(prevChar) && /[A-Z]/.test(nextChar)) {
      return true;
    }
    return false;
  }

  /**
   * Check if the transition looks like a proper noun boundary
   * (e.g., "JohnSmith" should be "John Smith")
   */
  private isProperNounBoundary(accumulated: string, nextChar: string): boolean {
    if (accumulated.length < 2) return false;
    
    // Check if accumulated ends with lowercase and next is uppercase
    const lastChar = accumulated.slice(-1);
    if (/[a-z]/.test(lastChar) && /[A-Z]/.test(nextChar)) {
      // Common name endings
      if (/(?:son|ton|man|ley|ell|ard|old|ohn|ick|ert|ark|ane|ine|ice|ace)$/i.test(accumulated)) {
        return true;
      }
      // General check: if word is 3+ chars and ends in a vowel or common ending
      if (accumulated.length >= 3) {
        return true;
      }
    }
    return false;
  }

  /**
   * Predict whether there should be a word boundary
   */
  predict(ctx: CharacterContext): BoundaryPrediction {
    const { accumulatedWord, currentChar, nextChar, gapRatio } = ctx;
    
    // Empty or whitespace - no prediction needed
    if (!currentChar || !nextChar || /\s/.test(currentChar) || /\s/.test(nextChar)) {
      return { shouldBreak: false, confidence: 1.0, reason: 'geometric' };
    }

    // Very large gap - definitely a space
    if (gapRatio >= 1.5) {
      return { shouldBreak: true, confidence: 0.95, reason: 'geometric' };
    }

    // Negative or zero gap - definitely no space
    if (gapRatio <= 0) {
      return { shouldBreak: false, confidence: 0.95, reason: 'geometric' };
    }

    // Check capitalization boundary (lowercase to uppercase)
    if (this.checkCapitalizationBoundary(currentChar, nextChar)) {
      // But not if it's a common prefix situation like "iPhone" or "eBay"
      const lastTwoChars = accumulatedWord.slice(-2).toLowerCase();
      const isCommonCamelCase = lastTwoChars === 'i' || lastTwoChars === 'e';
      if (!this.startsWithPrefix(accumulatedWord) && !isCommonCamelCase) {
        return { shouldBreak: true, confidence: 0.85, reason: 'capitalization' };
      }
    }

    // Check proper noun boundary
    if (this.isProperNounBoundary(accumulatedWord, nextChar)) {
      return { shouldBreak: true, confidence: 0.80, reason: 'pattern' };
    }

    // Check if accumulated word ends with a suffix (suggests complete word)
    if (accumulatedWord.length >= 4 && this.endsWithSuffix(accumulatedWord)) {
      // If gap is moderate and word has a suffix, likely a boundary
      if (gapRatio >= 0.3) {
        return { shouldBreak: true, confidence: 0.75, reason: 'linguistic' };
      }
    }

    // Use bigram probability
    const bigramScore = this.getBigramScore(currentChar, nextChar);
    
    // Combine geometric and linguistic signals
    // Higher bigram score = less likely to be a boundary
    // Higher gap ratio = more likely to be a boundary
    
    const geometricSignal = gapRatio; // 0 = no gap, 1+ = large gap
    const linguisticSignal = 1 - bigramScore; // 0 = likely same word, 1 = likely different
    
    // Weighted combination
    const boundaryScore = geometricSignal * 0.6 + linguisticSignal * 0.4;
    
    // Threshold for boundary decision
    const threshold = 0.45;
    
    if (boundaryScore >= threshold) {
      return {
        shouldBreak: true,
        confidence: Math.min(0.9, 0.5 + boundaryScore * 0.4),
        reason: bigramScore < 0.5 ? 'linguistic' : 'geometric'
      };
    } else {
      return {
        shouldBreak: false,
        confidence: Math.min(0.9, 0.5 + (1 - boundaryScore) * 0.4),
        reason: bigramScore >= 0.5 ? 'linguistic' : 'geometric'
      };
    }
  }

  /**
   * Score the likelihood that a sequence of characters forms a valid word
   * Uses n-gram chain probability
   */
  scoreWordLikelihood(text: string): number {
    if (!text || text.length < 2) return 0.5;
    
    let totalScore = 0;
    let count = 0;
    
    for (let i = 0; i < text.length - 1; i++) {
      const score = this.getBigramScore(text[i], text[i + 1]);
      totalScore += score;
      count++;
    }
    
    return count > 0 ? totalScore / count : 0.5;
  }

  /**
   * Compare joining vs splitting two character sequences
   * Returns positive if joining is better, negative if splitting is better
   */
  compareJoinVsSplit(left: string, right: string): number {
    if (!left || !right) return 0;
    
    // Score for joined version
    const joinedScore = this.scoreWordLikelihood(left + right);
    
    // Score for keeping separate (average of both)
    const leftScore = this.scoreWordLikelihood(left);
    const rightScore = this.scoreWordLikelihood(right);
    const splitScore = (leftScore + rightScore) / 2;
    
    // Bonus for joined if it ends with common suffix
    let joinBonus = 0;
    if (this.endsWithSuffix(left + right)) joinBonus += 0.1;
    
    // Penalty for joined if there's a capitalization boundary
    const lastLeft = left.slice(-1);
    const firstRight = right.slice(0, 1);
    if (/[a-z]/.test(lastLeft) && /[A-Z]/.test(firstRight)) {
      joinBonus -= 0.3;
    }
    
    return (joinedScore + joinBonus) - splitScore;
  }
}

// Singleton instance
let _defaultModel: PredictiveTextModel | null = null;

export function getDefaultPredictiveModel(): PredictiveTextModel {
  if (!_defaultModel) {
    _defaultModel = new PredictiveTextModel();
  }
  return _defaultModel;
}
