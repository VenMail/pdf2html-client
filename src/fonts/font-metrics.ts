import type { FontMetrics, DetectedFont } from '../types/fonts.js';
import type { GoogleFont } from '../types/fonts.js';

export class FontMetricsComparator {
  async compare(
    detected: DetectedFont,
    googleFont: GoogleFont,
    variant: string
  ): Promise<number> {
    // Calculate similarity score (0-1)
    // Higher score = better match

    try {
      // Load Google Font metrics if available
      // For now, we'll use name similarity and basic metrics
      const nameSimilarity = this.calculateNameSimilarity(
        detected.family,
        googleFont.family
      );

      // Estimate Google Font metrics based on variant
      // todo: guess from a pool of best variants and load only those variants for exact best guess
      //since this is not currently loading fonts
      const estimatedMetrics = this.estimateGoogleFontMetrics(
        googleFont,
        variant,
        detected.metrics.unitsPerEm
      );

      // Compare metrics
      const metricsSimilarity = this.calculateSimilarity(
        detected.metrics,
        estimatedMetrics
      );

      // Combine name and metrics similarity
      return (nameSimilarity * 0.3) + (metricsSimilarity * 0.7);
    } catch (error) {
      console.warn('Failed to compare font metrics:', error);
      return 0.5;
    }
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase().trim();
    const s2 = name2.toLowerCase().trim();

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;

    // Simple word-based similarity
    const words1 = s1.split(/[\s-]+/);
    const words2 = s2.split(/[\s-]+/);
    const commonWords = words1.filter((w) => words2.includes(w));
    return commonWords.length / Math.max(words1.length, words2.length);
  }

  private estimateGoogleFontMetrics(
    googleFont: GoogleFont,
    variant: string,
    unitsPerEm: number
  ): FontMetrics {
    // Estimate metrics based on font category and variant
    // These are rough estimates - actual metrics would require loading the font
    void unitsPerEm;
    const baseSize = 1000; // Normalize to 1000 units
    const weight = parseInt(variant) || 400;

    let ascent = baseSize * 0.8;
    let descent = baseSize * 0.2;
    let capHeight = baseSize * 0.7;
    let xHeight = baseSize * 0.5;
    let averageWidth = baseSize * 0.5;
    let maxWidth = baseSize * 0.8;

    // Adjust based on font category
    if (googleFont.category === 'serif') {
      ascent = baseSize * 0.75;
      descent = baseSize * 0.25;
      capHeight = baseSize * 0.65;
      xHeight = baseSize * 0.45;
    } else if (googleFont.category === 'monospace') {
      averageWidth = baseSize * 0.6;
      maxWidth = baseSize * 0.6; // Monospace: same width
    }

    // Adjust based on weight
    if (weight >= 700) {
      averageWidth = averageWidth * 1.1;
      maxWidth = maxWidth * 1.1;
    } else if (weight <= 300) {
      averageWidth = averageWidth * 0.9;
      maxWidth = maxWidth * 0.9;
    }

    return {
      ascent,
      descent,
      capHeight,
      xHeight,
      averageWidth,
      maxWidth,
      unitsPerEm: baseSize
    };
  }

  calculateSimilarity(
    metrics1: FontMetrics,
    metrics2: FontMetrics
  ): number {
    const weights = {
      ascent: 0.2,
      descent: 0.2,
      capHeight: 0.15,
      xHeight: 0.15,
      averageWidth: 0.15,
      maxWidth: 0.15
    };

    let similarity = 0;
    let totalWeight = 0;

    for (const [metric, weight] of Object.entries(weights)) {
      const value1 = metrics1[metric as keyof FontMetrics];
      const value2 = metrics2[metric as keyof FontMetrics];

      if (value1 && value2) {
        const diff = Math.abs(value1 - value2);
        const max = Math.max(value1, value2);
        const metricSimilarity = 1 - Math.min(diff / max, 1);
        similarity += metricSimilarity * weight;
        totalWeight += weight;
      }
    }

    return totalWeight > 0 ? similarity / totalWeight : 0;
  }

  normalizeMetrics(metrics: FontMetrics, unitsPerEm: number): FontMetrics {
    if (unitsPerEm === 0) {
      return metrics;
    }

    return {
      ascent: (metrics.ascent / unitsPerEm) * 1000,
      descent: (metrics.descent / unitsPerEm) * 1000,
      capHeight: (metrics.capHeight / unitsPerEm) * 1000,
      xHeight: (metrics.xHeight / unitsPerEm) * 1000,
      averageWidth: (metrics.averageWidth / unitsPerEm) * 1000,
      maxWidth: (metrics.maxWidth / unitsPerEm) * 1000,
      unitsPerEm: 1000
    };
  }
}

