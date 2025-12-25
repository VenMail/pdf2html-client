/**
 * Text Post-Processor
 * 
 * Post-processing step to fix text fragmentation and detect overlaps.
 * This runs after PDFium extraction to merge fragmented text items
 * and detect overlapping regions that need vertical fine-tuning.
 */

import type { PDFTextContent } from '../../types/pdf.js';

/**
 * Overlap detection result
 */
export interface OverlapInfo {
  item1Index: number;
  item2Index: number;
  overlapX: number;      // Horizontal overlap in pixels
  overlapY: number;      // Vertical overlap in pixels
  overlapRatio: number;  // Overlap as ratio of smaller item
}

/**
 * Text post-processing options
 */
export interface TextPostProcessorOptions {
  /** Merge adjacent characters on same line */
  mergeFragmented?: boolean;
  /** Detect overlapping text regions */
  detectOverlaps?: boolean;
  /** Maximum gap ratio (gap / avgCharWidth) for merging */
  maxMergeGapRatio?: number;
  /** Minimum overlap ratio to report */
  minOverlapRatio?: number;
}

/**
 * Post-process text items to fix fragmentation and detect overlaps
 */
export class TextPostProcessor {
  private options: Required<TextPostProcessorOptions>;

  constructor(options?: TextPostProcessorOptions) {
    this.options = {
      mergeFragmented: options?.mergeFragmented ?? true,
      detectOverlaps: options?.detectOverlaps ?? true,
      maxMergeGapRatio: options?.maxMergeGapRatio ?? 0.5,
      minOverlapRatio: options?.minOverlapRatio ?? 0.1
    };
  }

  /**
   * Process text items - merge fragmented and detect overlaps
   */
  process(items: PDFTextContent[]): {
    items: PDFTextContent[];
    overlaps: OverlapInfo[];
  } {
    if (!items || items.length === 0) {
      return { items: [], overlaps: [] };
    }

    let processed = [...items];

    // Step 1: Merge fragmented text
    if (this.options.mergeFragmented) {
      processed = this.mergeFragmentedText(processed);
    }

    // Step 2: Detect overlaps
    let overlaps: OverlapInfo[] = [];
    if (this.options.detectOverlaps) {
      overlaps = this.detectOverlaps(processed);
    }

    return { items: processed, overlaps };
  }

  /**
   * Merge fragmented text items that should be part of the same word
   */
  private mergeFragmentedText(items: PDFTextContent[]): PDFTextContent[] {
    if (items.length <= 1) return items;

    // Sort by y (line) then x (position)
    const sorted = [...items].sort((a, b) => {
      const yDiff = a.y - b.y;
      if (Math.abs(yDiff) > Math.max(a.height, b.height) * 0.5) {
        return yDiff;
      }
      return a.x - b.x;
    });

    const merged: PDFTextContent[] = [];
    let current: PDFTextContent | null = null;

    for (const item of sorted) {
      if (!current) {
        current = { ...item };
        continue;
      }

      // Check if items are on the same line
      const sameLine = this.isSameLine(current, item);
      
      // Check if items have similar style
      const sameStyle = this.isSameStyle(current, item);

      if (!sameLine || !sameStyle) {
        merged.push(current);
        current = { ...item };
        continue;
      }

      // Calculate gap
      const gap = item.x - (current.x + current.width);
      const avgCharWidth = this.estimateCharWidth(current);
      const gapRatio = gap / Math.max(1, avgCharWidth);

      // Check if we should merge
      const shouldMerge = this.shouldMergeItems(current, item, gap, gapRatio);

      if (shouldMerge) {
        // Merge items
        const needsSpace = this.needsSpaceBetween(current, item, gapRatio);
        current.text = current.text + (needsSpace ? ' ' : '') + item.text;
        current.width = Math.max(current.width, (item.x + item.width) - current.x);
        current.height = Math.max(current.height, item.height);
      } else {
        merged.push(current);
        current = { ...item };
      }
    }

    if (current) {
      merged.push(current);
    }

    return merged;
  }

  /**
   * Check if two items are on the same line
   */
  private isSameLine(a: PDFTextContent, b: PDFTextContent): boolean {
    const avgHeight = (a.height + b.height) / 2;
    const tolerance = avgHeight * 0.5;
    
    // Check if vertical centers are close
    const centerA = a.y + a.height / 2;
    const centerB = b.y + b.height / 2;
    
    return Math.abs(centerA - centerB) <= tolerance;
  }

  /**
   * Check if two items have similar style
   */
  private isSameStyle(a: PDFTextContent, b: PDFTextContent): boolean {
    // Allow font size difference of 20%
    const sizeDiff = Math.abs(a.fontSize - b.fontSize) / Math.max(a.fontSize, b.fontSize);
    if (sizeDiff > 0.2) return false;

    // Font family should match
    if (a.fontFamily !== b.fontFamily) return false;

    // Color should match (if both have color)
    if (a.color && b.color && a.color !== b.color) return false;

    return true;
  }

  /**
   * Estimate average character width from a text item
   */
  private estimateCharWidth(item: PDFTextContent): number {
    const text = (item.text || '').replace(/\s+/g, '');
    if (text.length === 0) return item.fontSize * 0.5;
    return item.width / text.length;
  }

  /**
   * Determine if two items should be merged
   */
  private shouldMergeItems(
    current: PDFTextContent,
    next: PDFTextContent,
    gap: number,
    gapRatio: number
  ): boolean {
    // Negative gap (overlap) - definitely merge
    if (gap < 0) return true;

    // Very large gap - don't merge
    if (gapRatio > 2.0) return false;

    const currentText = current.text || '';
    const nextText = next.text || '';

    // Single character items are likely fragmented
    const currentIsSingle = currentText.trim().length === 1;
    const nextIsSingle = nextText.trim().length === 1;

    // If both are single characters and alphabetic, likely fragmented word
    const currentIsAlpha = /^[A-Za-z]$/.test(currentText.trim());
    const nextIsAlpha = /^[A-Za-z]$/.test(nextText.trim());

    if (currentIsSingle && nextIsSingle && currentIsAlpha && nextIsAlpha) {
      // Be aggressive about merging single letters
      return gapRatio <= 1.5;
    }

    // Both end/start with letters - likely same word
    const endsWithLetter = /[A-Za-z]$/.test(currentText);
    const startsWithLetter = /^[A-Za-z]/.test(nextText);

    if (endsWithLetter && startsWithLetter) {
      return gapRatio <= this.options.maxMergeGapRatio;
    }

    // Punctuation attachment
    if (/^[,.;:!?)\]}"']+$/.test(nextText.trim())) {
      return gapRatio <= 1.0;
    }

    // Default: use gap ratio threshold
    return gapRatio <= this.options.maxMergeGapRatio * 0.7;
  }

  /**
   * Determine if a space is needed between merged items
   */
  private needsSpaceBetween(
    current: PDFTextContent,
    next: PDFTextContent,
    gapRatio: number
  ): boolean {
    const currentText = current.text || '';
    const nextText = next.text || '';

    // No space before punctuation
    if (/^[,.;:!?)\]}"']+$/.test(nextText.trim())) {
      return false;
    }

    // No space after opening punctuation
    if (/[([{"']+$/.test(currentText.trim())) {
      return false;
    }

    // Single letter to single letter - no space (likely fragmented)
    if (/^[A-Za-z]$/.test(currentText.trim()) && /^[A-Za-z]$/.test(nextText.trim())) {
      return false;
    }

    // Letter to letter with small gap - no space
    if (/[A-Za-z]$/.test(currentText) && /^[A-Za-z]/.test(nextText) && gapRatio < 0.8) {
      return false;
    }

    // Moderate gap might need space
    return gapRatio >= 0.6;
  }

  /**
   * Detect overlapping text regions
   */
  private detectOverlaps(items: PDFTextContent[]): OverlapInfo[] {
    const overlaps: OverlapInfo[] = [];
    
    if (items.length <= 1) return overlaps;

    // Check each pair of items for overlap
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i];
        const b = items[j];

        const overlap = this.calculateOverlap(a, b);
        
        if (overlap && overlap.overlapRatio >= this.options.minOverlapRatio) {
          overlaps.push({
            item1Index: i,
            item2Index: j,
            ...overlap
          });
        }
      }
    }

    return overlaps;
  }

  /**
   * Calculate overlap between two text items
   */
  private calculateOverlap(
    a: PDFTextContent,
    b: PDFTextContent
  ): { overlapX: number; overlapY: number; overlapRatio: number } | null {
    // Calculate bounding boxes
    const aLeft = a.x;
    const aRight = a.x + a.width;
    const aTop = a.y;
    const aBottom = a.y + a.height;

    const bLeft = b.x;
    const bRight = b.x + b.width;
    const bTop = b.y;
    const bBottom = b.y + b.height;

    // Calculate overlap in each dimension
    const overlapX = Math.max(0, Math.min(aRight, bRight) - Math.max(aLeft, bLeft));
    const overlapY = Math.max(0, Math.min(aBottom, bBottom) - Math.max(aTop, bTop));

    // No overlap
    if (overlapX <= 0 || overlapY <= 0) {
      return null;
    }

    // Calculate overlap area and ratio
    const overlapArea = overlapX * overlapY;
    const aArea = a.width * a.height;
    const bArea = b.width * b.height;
    const smallerArea = Math.min(aArea, bArea);

    const overlapRatio = smallerArea > 0 ? overlapArea / smallerArea : 0;

    return { overlapX, overlapY, overlapRatio };
  }

  /**
   * Apply vertical fine-tuning based on overlap detection
   * Similar to smart underline detection - adjusts positions to reduce overlaps
   */
  adjustForOverlaps(items: PDFTextContent[], overlaps: OverlapInfo[]): PDFTextContent[] {
    if (overlaps.length === 0) return items;

    const adjusted = items.map(item => ({ ...item }));

    // Group overlaps by vertical proximity (likely same logical line)
    for (const overlap of overlaps) {
      const item1 = adjusted[overlap.item1Index];
      const item2 = adjusted[overlap.item2Index];

      // If significant vertical overlap, adjust the item that appears lower
      if (overlap.overlapY > 0 && overlap.overlapRatio >= 0.3) {
        const item1Center = item1.y + item1.height / 2;
        const item2Center = item2.y + item2.height / 2;

        // Shift the lower item down slightly
        if (item2Center > item1Center) {
          item2.y += overlap.overlapY * 0.5;
        } else {
          item1.y += overlap.overlapY * 0.5;
        }
      }
    }

    return adjusted;
  }
}

/**
 * Factory function
 */
export function createTextPostProcessor(options?: TextPostProcessorOptions): TextPostProcessor {
  return new TextPostProcessor(options);
}

/**
 * Get default post-processor instance
 */
let defaultPostProcessor: TextPostProcessor | null = null;
export function getDefaultTextPostProcessor(): TextPostProcessor {
  if (!defaultPostProcessor) {
    defaultPostProcessor = new TextPostProcessor();
  }
  return defaultPostProcessor;
}
