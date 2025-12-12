import type { DetectedFont, FontMetrics } from '../types/fonts.js';
import type { PDFTextContent, PDFFontInfo } from '../types/pdf.js';

export class FontDetector {
  detectFromTextContent(textContent: PDFTextContent[]): DetectedFont[] {
    const fontMap = new Map<string, DetectedFont>();

    for (const text of textContent) {
      if (!text.fontInfo) {
        continue;
      }

      const fontKey = this.getFontKey(text.fontInfo);
      if (!fontMap.has(fontKey)) {
        fontMap.set(fontKey, this.createDetectedFont(text));
      }
    }

    return Array.from(fontMap.values());
  }

  private getFontKey(fontInfo: PDFFontInfo): string {
    return `${fontInfo.name}-${fontInfo.metrics.ascent}-${fontInfo.metrics.descent}`;
  }

  private createDetectedFont(text: PDFTextContent): DetectedFont {
    if (!text.fontInfo) {
      throw new Error('Font info is required');
    }

    const metrics: FontMetrics = {
      ascent: text.fontInfo.metrics.ascent,
      descent: text.fontInfo.metrics.descent,
      capHeight: text.fontInfo.metrics.capHeight,
      xHeight: text.fontInfo.metrics.xHeight,
      averageWidth: text.fontInfo.metrics.averageWidth,
      maxWidth: text.fontInfo.metrics.maxWidth,
      unitsPerEm: 1000 // Default, should be extracted from font
    };

    return {
      name: text.fontInfo.name,
      family: this.extractFamilyName(text.fontInfo.name),
      weight: text.fontWeight,
      style: text.fontStyle,
      embedded: text.fontInfo.embedded,
      metrics,
      encoding: text.fontInfo.encoding
    };
  }

  private extractFamilyName(fontName: string): string {
    // Remove common suffixes like -Bold, -Italic, -Regular
    return fontName
      .replace(/-Bold$/, '')
      .replace(/-Italic$/, '')
      .replace(/-Regular$/, '')
      .replace(/-Oblique$/, '')
      .trim();
  }

  analyzeFontCharacteristics(font: DetectedFont): FontCharacteristics {
    return {
      isSerif: this.detectSerif(font),
      isMonospace: this.detectMonospace(font),
      weightCategory: this.categorizeWeight(font.weight),
      styleCategory: font.style
    };
  }

  private detectSerif(font: DetectedFont): boolean {
    // Simple heuristic: check font name for serif indicators
    const name = font.name.toLowerCase();
    return (
      name.includes('serif') ||
      name.includes('times') ||
      name.includes('georgia') ||
      name.includes('garamond')
    );
  }

  private detectMonospace(font: DetectedFont): boolean {
    // Check if average width is close to max width (monospace characteristic)
    const ratio = font.metrics.averageWidth / font.metrics.maxWidth;
    return ratio > 0.9;
  }

  private categorizeWeight(weight: number): 'light' | 'normal' | 'medium' | 'bold' | 'heavy' {
    if (weight < 400) return 'light';
    if (weight < 500) return 'normal';
    if (weight < 700) return 'medium';
    if (weight < 900) return 'bold';
    return 'heavy';
  }
}

export interface FontCharacteristics {
  isSerif: boolean;
  isMonospace: boolean;
  weightCategory: 'light' | 'normal' | 'medium' | 'bold' | 'heavy';
  styleCategory: 'normal' | 'italic' | 'oblique';
}


