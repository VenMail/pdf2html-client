import type { PDFTextContent } from '../../types/pdf.js';
import type { DocumentStatistics, TextRun } from './types.js';
import { StatisticalSpaceDetector } from './space-detector.js';

export class ImprovedTextMerger {
  private spaceDetector: StatisticalSpaceDetector;

  constructor(private stats: DocumentStatistics) {
    this.spaceDetector = new StatisticalSpaceDetector(stats);
  }

  mergeTextRuns(items: PDFTextContent[]): TextRun[] {
    if (!items || items.length === 0) return [];
    const sorted = [...items].sort((a, b) => a.x - b.x);

    const lineModel = this.spaceDetector.buildLineGapModel(sorted);

    const merged: TextRun[] = [];
    let current: TextRun | null = null;
    let lastItem: PDFTextContent | null = null;

    for (const item of sorted) {
      if (!current) {
        current = this.textContentToRun(item);
        lastItem = item;
        continue;
      }

      if (this.shouldMerge(current, item)) {
        const insertSpace = lastItem
          ? this.spaceDetector.shouldInsertSpace(lastItem, item, { lineModel })
          : this.spaceDetector.shouldInsertSpace(this.runToTextContent(current), item, { lineModel });
        current.text += (insertSpace ? ' ' : '') + item.text;
        const endX = Math.max(current.x + current.width, item.x + item.width);
        current.width = Math.max(0, endX - current.x);
        const mergedTop = Math.max(current.y + current.height, item.y + item.height);
        const mergedBottom = Math.min(current.y, item.y);
        current.y = mergedBottom;
        current.height = Math.max(0, mergedTop - mergedBottom);
        lastItem = item;
      } else {
        merged.push(current);
        current = this.textContentToRun(item);
        lastItem = item;
      }
    }

    if (current) merged.push(current);
    return merged;
  }

  private shouldMerge(run: TextRun, item: PDFTextContent): boolean {
    // Font family must match (normalize for comparison)
    const runFont = (run.fontFamily || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const itemFont = (item.fontFamily || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (runFont !== itemFont) return false;
    
    // Check if this looks like fragmented text (short items, same font family)
    const itemLen = (item.text || '').trim().length;
    const runLen = (run.text || '').trim().length;
    const isFragmented = itemLen <= 3 || runLen <= 5;
    
    // For fragmented text with same font family, be VERY aggressive about merging
    // PDFium often reports wildly different font sizes for the same visual text
    if (isFragmented) {
      // Only check that font sizes are in a reasonable ratio (not 10x different)
      const minSize = Math.min(run.fontSize, item.fontSize);
      const maxSize = Math.max(run.fontSize, item.fontSize);
      if (maxSize > minSize * 3) return false; // Only reject if 3x or more different
    } else {
      // For longer runs, use more conservative tolerance
      const fontSizeTolerance = Math.max(run.fontSize, item.fontSize) * 0.5; // 50% tolerance
      if (Math.abs(run.fontSize - item.fontSize) > fontSizeTolerance) return false;
    }
    
    // Color check - be lenient for fragmented text
    if (run.color !== item.color && !isFragmented) {
      // For non-fragmented, colors must match
      return false;
    }
    
    // Rotation must be similar
    const runRot = typeof run.rotation === 'number' ? run.rotation : 0;
    const itemRot = typeof item.rotation === 'number' ? item.rotation : 0;
    if (Math.abs(runRot - itemRot) > 5) return false; // Allow 5 degree tolerance
    
    // Gap check - for fragmented text, be very aggressive
    const gap = item.x - (run.x + run.width);
    const avgFontSize = (run.fontSize + item.fontSize) / 2;
    
    if (isFragmented) {
      // For fragmented text, allow gaps up to 2x the average font size
      // This handles cases where PDFium reports incorrect widths
      const maxGap = avgFontSize * 2;
      return gap < maxGap;
    } else {
      // For normal text, use word gap statistics
      const baseMaxGap = this.stats.gaps.p75WordGap || this.stats.gaps.medianWordGap || avgFontSize * 0.5;
      return gap < baseMaxGap * 2;
    }
  }

  private textContentToRun(item: PDFTextContent): TextRun {
    return {
      text: item.text,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
      fontFamily: item.fontFamily,
      fontWeight: item.fontWeight,
      fontStyle: item.fontStyle,
      color: item.color,
      fontInfo: item.fontInfo,
      textDecoration: item.textDecoration,
      rotation: item.rotation
    };
  }

  private runToTextContent(run: TextRun): PDFTextContent {
    return {
      text: run.text,
      x: run.x,
      y: run.y,
      width: run.width,
      height: run.height,
      fontSize: run.fontSize,
      fontFamily: run.fontFamily,
      fontWeight: run.fontWeight,
      fontStyle: run.fontStyle,
      color: run.color,
      fontInfo: run.fontInfo,
      textDecoration: run.textDecoration,
      rotation: run.rotation
    };
  }
}
