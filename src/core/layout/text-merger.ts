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
    if (run.fontFamily !== item.fontFamily) return false;
    if (Math.abs(run.fontSize - item.fontSize) > 0.5) return false;
    if (run.fontWeight !== item.fontWeight) return false;
    if (run.fontStyle !== item.fontStyle) return false;
    if (run.color !== item.color) return false;
    const runRot = typeof run.rotation === 'number' ? run.rotation : 0;
    const itemRot = typeof item.rotation === 'number' ? item.rotation : 0;
    if (Math.abs(runRot - itemRot) > 0.01) return false;

    const gap = item.x - (run.x + run.width);
    const maxGap = (this.stats.gaps.p75WordGap || this.stats.gaps.medianWordGap || 3) * 2;
    return gap < maxGap;
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
      rotation: run.rotation
    };
  }
}
