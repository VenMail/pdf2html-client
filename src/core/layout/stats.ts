import type { PDFPage, PDFTextContent } from '../../types/pdf.js';
import type { DocumentStatistics, GapStatistics, LayoutStatistics, FontStatistics, TextLine } from './types.js';

export class DocumentStatisticsAnalyzer {
  analyze(page: PDFPage, lines: TextLine[]): DocumentStatistics {
    const items = page.content.text || [];
    const nonEmpty = items.filter((t) => t.text && t.text.trim().length > 0);

    const heights = nonEmpty.map((t) => Math.max(1, t.height));
    const medianHeight = this.median(heights) || 12;
    const fontSizes = nonEmpty.map((t) => Math.max(1, t.fontSize));
    const medianFontSize = this.median(fontSizes) || 12;

    const gaps = this.analyzeGaps(lines);
    const fonts = this.analyzeFonts(nonEmpty);
    const layout = this.analyzeLayout(lines, page.width);

    const totalChars = nonEmpty.reduce((sum, t) => sum + t.text.length, 0);
    const textDensity = totalChars / Math.max(1, page.width * page.height);
    const totalWords = nonEmpty.reduce((sum, t) => sum + t.text.trim().split(/\s+/).length, 0);
    const averageWordsPerLine = lines.length > 0 ? totalWords / lines.length : 0;

    return {
      gaps,
      fonts,
      layout,
      medianHeight,
      medianFontSize,
      pageWidth: page.width,
      pageHeight: page.height,
      textDensity,
      averageWordsPerLine
    };
  }

  private analyzeGaps(lines: TextLine[]): GapStatistics {
    const characterGaps: number[] = [];
    const wordGaps: number[] = [];
    const lineGaps: number[] = [];
    const paragraphGaps: number[] = [];

    for (const line of lines) {
      const sorted = [...line.items].sort((a, b) => a.x - b.x);
      for (let i = 0; i < sorted.length - 1; i++) {
        const current = sorted[i];
        const next = sorted[i + 1];
        const gap = next.x - (current.x + current.width);
        if (gap < 0) continue;
        const avgFontSize = (current.fontSize + next.fontSize) / 2;
        const normalizedGap = gap / Math.max(1, avgFontSize);
        if (normalizedGap < 0.15) {
          characterGaps.push(gap);
        } else if (normalizedGap < 0.8) {
          characterGaps.push(gap);
          if (normalizedGap > 0.25) wordGaps.push(gap);
        } else {
          wordGaps.push(gap);
        }
      }
    }

    const sortedLines = [...lines].sort((a, b) => a.rect.top - b.rect.top);
    for (let i = 0; i < sortedLines.length - 1; i++) {
      const currentLine = sortedLines[i];
      const nextLine = sortedLines[i + 1];
      const gap = nextLine.rect.top - (currentLine.rect.top + currentLine.rect.height);
      if (gap >= 0) {
        lineGaps.push(gap);
        if (gap > currentLine.height * 1.5) paragraphGaps.push(gap);
      }
    }

    return {
      characterGaps,
      wordGaps,
      lineGaps,
      paragraphGaps,
      medianCharGap: this.median(characterGaps) || 0,
      medianWordGap: this.median(wordGaps) || 3,
      medianLineGap: this.median(lineGaps) || 12,
      medianParagraphGap: this.median(paragraphGaps) || 20,
      p25WordGap: this.percentile(wordGaps, 0.25) || 2,
      p75WordGap: this.percentile(wordGaps, 0.75) || 5
    };
  }

  private analyzeFonts(items: PDFTextContent[]): FontStatistics {
    const fontSizes = new Map<number, number>();
    const fontFamilies = new Map<string, number>();

    for (const item of items) {
      const size = Math.round(item.fontSize * 10) / 10;
      fontSizes.set(size, (fontSizes.get(size) || 0) + 1);
      const family = item.fontFamily || 'default';
      fontFamilies.set(family, (fontFamilies.get(family) || 0) + 1);
    }

    let dominantFontSize = 12;
    let maxSizeCount = 0;
    for (const [size, count] of fontSizes) {
      if (count > maxSizeCount) {
        maxSizeCount = count;
        dominantFontSize = size;
      }
    }

    let dominantFontFamily = 'default';
    let maxFamilyCount = 0;
    for (const [family, count] of fontFamilies) {
      if (count > maxFamilyCount) {
        maxFamilyCount = count;
        dominantFontFamily = family;
      }
    }

    const sizes = items.map((t) => t.fontSize);
    const meanSize = sizes.length > 0 ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0;
    const variance = sizes.length > 0
      ? sizes.reduce((sum, size) => sum + Math.pow(size - meanSize, 2), 0) / sizes.length
      : 0;

    return {
      fontSizes,
      fontFamilies,
      dominantFontSize,
      dominantFontFamily,
      fontSizeVariance: variance
    };
  }

  private analyzeLayout(lines: TextLine[], pageWidth: number): LayoutStatistics {
    const leftMargins: number[] = [];
    const rightMargins: number[] = [];
    const xPositions: number[] = [];

    for (const line of lines) {
      leftMargins.push(line.minX);
      rightMargins.push(pageWidth - line.maxX);
      for (const item of line.items) {
        xPositions.push(Math.round(item.x));
      }
    }

    const columnPositions = this.findClusters(xPositions, 5);
    const sortedMargins = [...leftMargins].sort((a, b) => a - b);
    const baseMargin = this.median(sortedMargins) || 0;
    const indentLevels = this.findClusters(leftMargins.filter((m) => m > baseMargin), 3);

    return {
      leftMargins,
      rightMargins,
      columnPositions,
      indentLevels,
      medianLeftMargin: baseMargin,
      commonIndents: indentLevels
    };
  }

  private findClusters(values: number[], tolerance: number): number[] {
    if (values.length === 0) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const clusters: number[] = [];
    let currentCluster: number[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] <= tolerance) {
        currentCluster.push(sorted[i]);
      } else {
        if (currentCluster.length >= 2) clusters.push(this.mean(currentCluster));
        currentCluster = [sorted[i]];
      }
    }
    if (currentCluster.length >= 2) clusters.push(this.mean(currentCluster));
    return clusters;
  }

  private median(arr: number[]): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  private percentile(arr: number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const index = Math.floor(sorted.length * p);
    return sorted[index];
  }

  private mean(arr: number[]): number {
    return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  }
}
