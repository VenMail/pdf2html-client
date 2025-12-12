import type {
  DetectedFont,
  FontMapping,
  FontMappingOptions,
  GoogleFont
} from '../types/fonts.js';
import { FontDetector } from './font-detector.js';
import { FontMetricsComparator } from './font-metrics.js';
import { GoogleFontsAPI } from './google-fonts-api.js';

export class FontMapper {
  private detector: FontDetector;
  private metricsComparator: FontMetricsComparator;
  private googleFontsAPI: GoogleFontsAPI;
  private mappingCache: Map<string, FontMapping> = new Map();
  private options: FontMappingOptions;

  constructor(
    options: FontMappingOptions = {
      strategy: 'similar',
      similarityThreshold: 0.7,
      cacheEnabled: true
    },
    apiKey?: string
  ) {
    this.options = options;
    this.detector = new FontDetector();
    this.metricsComparator = new FontMetricsComparator();
    this.googleFontsAPI = new GoogleFontsAPI(apiKey);
  }

  async mapFont(detectedFont: DetectedFont): Promise<FontMapping> {
    const cacheKey = this.getCacheKey(detectedFont);
    
    if (this.options.cacheEnabled && this.mappingCache.has(cacheKey)) {
      return this.mappingCache.get(cacheKey)!;
    }

    const mapping = await this.findBestMatch(detectedFont);
    
    if (this.options.cacheEnabled) {
      this.mappingCache.set(cacheKey, mapping);
    }

    return mapping;
  }

  async mapFonts(detectedFonts: DetectedFont[]): Promise<FontMapping[]> {
    const mappings: FontMapping[] = [];

    for (const font of detectedFonts) {
      const mapping = await this.mapFont(font);
      mappings.push(mapping);
    }

    return mappings;
  }

  private async findBestMatch(detectedFont: DetectedFont): Promise<FontMapping> {
    const characteristics = this.detector.analyzeFontCharacteristics(detectedFont);
    const candidates = await this.findCandidates(detectedFont, characteristics);

    if (candidates.length === 0) {
      return this.createFallbackMapping(detectedFont);
    }

    let bestMatch: { font: GoogleFont; variant: string; similarity: number } | null = null;

    for (const candidate of candidates) {
      for (const variant of candidate.variants) {
        const similarity = await this.metricsComparator.compare(
          detectedFont,
          candidate,
          variant
        );

        if (
          similarity >= this.options.similarityThreshold &&
          (!bestMatch || similarity > bestMatch.similarity)
        ) {
          bestMatch = { font: candidate, variant, similarity };
        }
      }
    }

    if (!bestMatch) {
      return this.createFallbackMapping(detectedFont);
    }

    return {
      detectedFont,
      googleFont: bestMatch.font,
      variant: bestMatch.variant,
      similarity: bestMatch.similarity,
      fallbackChain: this.generateFallbackChain(bestMatch.font, characteristics)
    };
  }

  private async findCandidates(
    detectedFont: DetectedFont,
    characteristics: { isSerif: boolean; isMonospace: boolean; weightCategory: string }
  ): Promise<GoogleFont[]> {
    const allFonts = await this.googleFontsAPI.getAllFonts();

    return allFonts.filter((font) => {
      if (characteristics.isMonospace && font.category !== 'monospace') {
        return false;
      }
      if (characteristics.isSerif && font.category !== 'serif') {
        return false;
      }
      if (!characteristics.isSerif && !characteristics.isMonospace && font.category === 'serif') {
        return false;
      }

      // Check if font name is similar
      const nameSimilarity = this.calculateNameSimilarity(
        detectedFont.family,
        font.family
      );

      return nameSimilarity > 0.3;
    });
  }

  private calculateNameSimilarity(name1: string, name2: string): number {
    const s1 = name1.toLowerCase();
    const s2 = name2.toLowerCase();

    if (s1 === s2) return 1.0;
    if (s1.includes(s2) || s2.includes(s1)) return 0.8;

    // Simple Levenshtein-like similarity
    const longer = s1.length > s2.length ? s1 : s2;
    const editDistance = this.levenshteinDistance(s1, s2);
    
    return 1 - editDistance / longer.length;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= s2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= s1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= s2.length; i++) {
      for (let j = 1; j <= s1.length; j++) {
        if (s2.charAt(i - 1) === s1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[s2.length][s1.length];
  }

  private createFallbackMapping(detectedFont: DetectedFont): FontMapping {
    const characteristics = this.detector.analyzeFontCharacteristics(detectedFont);
    let fallbackFont: GoogleFont;

    if (characteristics.isMonospace) {
      fallbackFont = {
        family: 'Roboto Mono',
        variants: ['400'],
        subsets: ['latin'],
        category: 'monospace',
        version: 'v22',
        lastModified: '2023-01-01',
        files: {}
      };
    } else if (characteristics.isSerif) {
      fallbackFont = {
        family: 'Merriweather',
        variants: ['400'],
        subsets: ['latin'],
        category: 'serif',
        version: 'v30',
        lastModified: '2023-01-01',
        files: {}
      };
    } else {
      fallbackFont = {
        family: 'Roboto',
        variants: ['400'],
        subsets: ['latin'],
        category: 'sans-serif',
        version: 'v30',
        lastModified: '2023-01-01',
        files: {}
      };
    }

    return {
      detectedFont,
      googleFont: fallbackFont,
      variant: '400',
      similarity: 0.5,
      fallbackChain: [fallbackFont.family, 'Arial', 'sans-serif']
    };
  }

  private generateFallbackChain(
    font: GoogleFont,
    characteristics: { isSerif: boolean; isMonospace: boolean }
  ): string[] {
    const chain = [font.family];

    if (characteristics.isMonospace) {
      chain.push('Courier New', 'monospace');
    } else if (characteristics.isSerif) {
      chain.push('Times New Roman', 'serif');
    } else {
      chain.push('Arial', 'sans-serif');
    }

    return chain;
  }

  private getCacheKey(font: DetectedFont): string {
    return `${font.name}-${font.weight}-${font.style}`;
  }

  clearCache(): void {
    this.mappingCache.clear();
  }
}

