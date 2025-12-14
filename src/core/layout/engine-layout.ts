import type { PDFPage, PDFTextContent } from '../../types/pdf.js';
import {
  type DocumentStatistics,
  type PageTextRegionLayout,
  type TextLine,
  type TextRegion,
  type Rect
} from './types.js';
import { DocumentStatisticsAnalyzer } from './stats.js';
import { ImprovedTextMerger } from './text-merger.js';
import { StatisticalSpaceDetector } from './space-detector.js';
import { ObstacleCollector } from './obstacles.js';
import { TextReconstructionPipelineV2 } from '../text-pipeline/pipeline.js';
import { normalizeGlyphItems } from '../text-pipeline/normalizer.js';
import { buildLineGeometryModel } from '../text-pipeline/line-model.js';
import { getClassifierProfile, resolveScriptForGlyphs } from '../text-pipeline/classifier-db.js';
import { RuleBoundaryClassifier } from '../text-pipeline/rule-classifier.js';

export class RegionLayoutAnalyzer {
  private statsAnalyzer = new DocumentStatisticsAnalyzer();
  private obstacles = new ObstacleCollector();
  private stats: DocumentStatistics | null = null;
  private spaceDetector: StatisticalSpaceDetector | null = null;
  private textMerger: ImprovedTextMerger | null = null;
  private textPipeline: 'legacy' | 'v2';
  private pipelineV2: TextReconstructionPipelineV2 | null = null;
  private textClassifierProfile?: string;

  constructor(options?: { textPipeline?: 'legacy' | 'v2'; textClassifierProfile?: string }) {
    this.textPipeline = options?.textPipeline ?? 'legacy';
    this.textClassifierProfile = options?.textClassifierProfile;
    this.pipelineV2 = this.textPipeline === 'v2'
      ? new TextReconstructionPipelineV2({ classifierProfile: this.textClassifierProfile })
      : null;
  }

  reconstructLineTokens(items: PDFTextContent[]): Array<
    | { type: 'text'; text: string; sample: PDFTextContent }
    | { type: 'space' }
  > {
    if (!items || items.length === 0) return [];

    if (this.textPipeline === 'v2') {
      const glyphs = normalizeGlyphItems(items);
      if (glyphs.length === 0) return [];
      const model = buildLineGeometryModel(glyphs);

      const profile = getClassifierProfile(this.textClassifierProfile);
      const resolvedScript = profile.script === 'auto' ? resolveScriptForGlyphs(glyphs) : profile.script;
      const classifier = new RuleBoundaryClassifier();
      const ctx = { profile, resolvedScript };

      const styleKey = (t: PDFTextContent): string => [
        t.fontFamily,
        String(t.fontSize),
        String(t.fontWeight),
        String(t.fontStyle),
        String(t.color)
      ].join('|');

      const out: Array<{ type: 'text'; text: string; sample: PDFTextContent } | { type: 'space' }> = [];
      let current: { type: 'text'; text: string; sample: PDFTextContent } | null = null;
      let pendingSpace = false;

      for (let i = 0; i < glyphs.length; i++) {
        const g = glyphs[i];
        const source = g.source;
        if (!source) continue;

        if (!current) {
          current = { type: 'text', text: g.text, sample: source };
          pendingSpace = false;
          continue;
        }

        const prev = glyphs[i - 1];
        const d = classifier.classify(prev, g, model, ctx);
        pendingSpace = d.type === 'space';

        const prevKey = styleKey(current.sample);
        const nextKey = styleKey(source);
        const styleChanged = prevKey !== nextKey;

        if (styleChanged) {
          out.push(current);
          if (pendingSpace) out.push({ type: 'space' });
          current = { type: 'text', text: g.text, sample: source };
          pendingSpace = false;
          continue;
        }

        if (pendingSpace) {
          current.text += ' ';
          pendingSpace = false;
        }
        current.text += g.text;
      }

      if (current) out.push(current);
      return out;
    }

    // Legacy: use StatisticalSpaceDetector decisions but still segment by style.
    const ordered = [...items].sort((a, b) => a.x - b.x);
    const lineModel = this.spaceDetector ? this.spaceDetector.buildLineGapModel(ordered) : undefined;

    const styleKey = (t: PDFTextContent): string => [
      t.fontFamily,
      String(t.fontSize),
      String(t.fontWeight),
      String(t.fontStyle),
      String(t.color)
    ].join('|');

    const out: Array<{ type: 'text'; text: string; sample: PDFTextContent } | { type: 'space' }> = [];
    let current: { type: 'text'; text: string; sample: PDFTextContent } | null = null;
    let prevItem: PDFTextContent | undefined;

    for (const item of ordered) {
      if (!current) {
        current = { type: 'text', text: item.text, sample: item };
        prevItem = item;
        continue;
      }

      const insertSpace =
        !!prevItem &&
        !!this.spaceDetector &&
        this.spaceDetector.shouldInsertSpace(prevItem, item, { lineModel });

      const prevKey = styleKey(current.sample);
      const nextKey = styleKey(item);
      const styleChanged = prevKey !== nextKey;

      if (styleChanged) {
        out.push(current);
        if (insertSpace) out.push({ type: 'space' });
        current = { type: 'text', text: item.text, sample: item };
      } else {
        if (insertSpace) current.text += ' ';
        current.text += item.text;
      }

      prevItem = item;
    }

    if (current) out.push(current);
    return out;
  }

  analyze(page: PDFPage): PageTextRegionLayout {
    const items = page.content.text || [];
    const nonEmpty = items.filter((t) => t.text && t.text.trim().length > 0);

    // Precompute median height for line grouping tolerance
    const heights = nonEmpty.map((t) => Math.max(1, t.height)).sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 12;

    const lines = this.groupIntoLines(nonEmpty, page.height, medianHeight);
    this.stats = this.statsAnalyzer.analyze(page, lines);
    this.spaceDetector = new StatisticalSpaceDetector(this.stats);
    this.textMerger = new ImprovedTextMerger(this.stats);

    const mergedLines: TextLine[] = lines.map((line) => ({
      ...line,
      mergedRuns: this.textMerger ? this.textMerger.mergeTextRuns(line.items) : []
    }));

    const { soft, hard } = this.obstacles.collect(page);
    const regions = this.groupLinesIntoRegions(mergedLines, soft, hard);

    for (const region of regions) {
      const hardOverlap = hard.some((o) => this.intersectionArea(region.rect, o) > 0);
      const softOverlapArea = soft.reduce((acc, o) => acc + this.intersectionArea(region.rect, o), 0);
      const softOverlapThreshold = Math.max(2, (this.stats.medianHeight * this.stats.medianHeight) * 0.2);
      const overlap = hardOverlap || softOverlapArea > softOverlapThreshold;
      region.overlapsObstacle = overlap;
      region.nearestObstacleDistance = this.obstacles.nearestDistance(region.rect, soft);

      const rotationInRegion = region.lines.some((l) => l.hasRotation);
      const minLinesForFlow = region.lines.length >= 2;
      const stableLineHeights = this.isStableLineHeight(region.lines);
      const stableIndent = this.isStableIndent(region.lines);

      region.flowAllowed = !rotationInRegion && !overlap && minLinesForFlow && stableLineHeights && stableIndent;
      region.paragraphs = region.flowAllowed
        ? this.buildParagraphs(region)
        : [];
    }

    return {
      regions,
      lines: mergedLines,
      medianFontSize: this.stats.medianFontSize,
      medianHeight: this.stats.medianHeight,
      stats: this.stats
    };
  }

  mergeTextRunsByLine(page: PDFPage): PDFTextContent[] {
    const analysis = this.analyze(page);
    const out: PDFTextContent[] = [];
    for (const line of analysis.lines) {
      out.push(...this.mergeTextRuns(line.items));
    }
    return out;
  }

  mergeTextRuns(items: PDFTextContent[]): PDFTextContent[] {
    if (!this.textMerger) return items;
    return this.textMerger.mergeTextRuns(items).map((run) => ({
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
    }));
  }

  reconstructLineText(items: PDFTextContent[]): string {
    if (!items || items.length === 0) return '';

    if (this.textPipeline === 'v2' && this.pipelineV2) {
      const raw = this.pipelineV2.reconstructLineText(items);
      if (/(https?:\/\/|www\.)/i.test(raw)) return raw;
      return this.normalizeText(raw);
    }

    if (!this.spaceDetector) {
      return items.map((i) => i.text).join('');
    }

    const ordered = [...items].sort((a, b) => a.x - b.x);
    const lineModel = this.spaceDetector.buildLineGapModel(ordered);

    const parts: string[] = [];
    let prev: PDFTextContent | undefined;
    for (const t of ordered) {
      if (prev && this.spaceDetector.shouldInsertSpace(prev, t, { lineModel })) {
        parts.push(' ');
      }
      parts.push(t.text);
      prev = t;
    }

    const out = parts.join('');
    if (/(https?:\/\/|www\.)/i.test(out)) return out;
    return this.normalizeText(out);
  }

  private groupIntoLines(items: PDFTextContent[], pageHeight: number, medianHeight: number): TextLine[] {
    const sorted = [...items].sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 0.25) return yDiff;
      return a.x - b.x;
    });

    const lines: Array<{ items: PDFTextContent[]; ySum: number; yCount: number; height: number; fontSizeSum: number; fontMap: Map<string, number> }> = [];

    for (const item of sorted) {
      const baseTol = Math.max(1.5, Math.min(medianHeight, Math.max(1, item.height)) * 0.45);
      const isTiny = Math.max(1, item.height) < Math.max(2, medianHeight * 0.6);
      const isPunctOrQuote = item.text.length <= 2 && /[\u2018\u2019\u201C\u201D'"`.,;:!?()[\]{}]/.test(item.text);
      const tol = (isTiny && isPunctOrQuote)
        ? Math.max(baseTol, Math.max(2, medianHeight * 0.85))
        : baseTol;
      let target: (typeof lines)[number] | undefined;

      for (const line of lines) {
        const yAvg = line.ySum / Math.max(1, line.yCount);
        if (Math.abs(yAvg - item.y) <= tol) {
          target = line;
          break;
        }
      }

      if (!target) {
        lines.push({ items: [item], ySum: item.y, yCount: 1, height: item.height, fontSizeSum: item.fontSize, fontMap: new Map([[item.fontFamily, 1]]) });
      } else {
        target.items.push(item);
        target.ySum += item.y;
        target.yCount += 1;
        target.height = Math.max(target.height, item.height);
        target.fontSizeSum += item.fontSize;
        target.fontMap.set(item.fontFamily, (target.fontMap.get(item.fontFamily) || 0) + 1);
      }
    }

    const normalized: TextLine[] = lines
      .map((l) => {
        const lineItems = [...l.items].sort((a, b) => a.x - b.x);
        const minX = Math.min(...lineItems.map((t) => t.x));
        const maxX = Math.max(...lineItems.map((t) => t.x + t.width));
        const topPdf = Math.max(...lineItems.map((t) => t.y + t.height));
        const top = pageHeight - topPdf;
        const height = Math.max(1, Math.round(Math.max(...lineItems.map((t) => t.height))));
        const hasRotation = lineItems.some((t) => typeof t.rotation === 'number' && Math.abs(t.rotation) > 0.01);
        const avgFontSize = l.fontSizeSum / Math.max(1, l.items.length);
        let dominantFont = 'default';
        let maxCount = 0;
        for (const [font, count] of l.fontMap) {
          if (count > maxCount) {
            maxCount = count;
            dominantFont = font;
          }
        }
        return {
          items: lineItems,
          mergedRuns: [],
          rect: { left: minX, top, width: Math.max(0, maxX - minX), height },
          minX,
          maxX,
          topPdf,
          height,
          hasRotation,
          avgFontSize,
          dominantFont
        };
      })
      .sort((a, b) => b.topPdf - a.topPdf);

    return normalized;
  }

  private groupLinesIntoRegions(lines: TextLine[], soft: Rect[], hard: Rect[]): TextRegion[] {
    type RegionBuild = {
      lines: TextLine[];
      minX: number;
      maxX: number;
      top: number;
      bottom: number;
    };

    const regions: RegionBuild[] = [];
    const blockGapThreshold = Math.max(6, this.stats?.medianHeight ? this.stats.medianHeight * 1.8 : 6);
    const indentThreshold = Math.max(8, this.stats?.medianFontSize ? this.stats.medianFontSize * 2.0 : 8);

    const ordered = [...lines].sort((a, b) => {
      const yDiff = a.rect.top - b.rect.top;
      if (Math.abs(yDiff) > 1) return yDiff;
      return a.minX - b.minX;
    });

    for (const line of ordered) {
      const prev = regions.length > 0 ? regions[regions.length - 1] : undefined;
      const prevLine = prev?.lines[prev.lines.length - 1];

      const prevBottom = prevLine ? prevLine.rect.top + prevLine.rect.height : 0;
      const startNew =
        !prev ||
        !prevLine ||
        (line.rect.top - prevBottom > blockGapThreshold) ||
        (Math.abs(line.minX - prevLine.minX) > indentThreshold && line.rect.top - prevLine.rect.top > Math.max(2, this.stats?.medianHeight ? this.stats.medianHeight * 0.6 : 2));

      if (startNew) {
        regions.push({
          lines: [line],
          minX: line.minX,
          maxX: line.maxX,
          top: line.rect.top,
          bottom: line.rect.top + line.rect.height
        });
      } else {
        prev.lines.push(line);
        prev.minX = Math.min(prev.minX, line.minX);
        prev.maxX = Math.max(prev.maxX, line.maxX);
        prev.top = Math.min(prev.top, line.rect.top);
        prev.bottom = Math.max(prev.bottom, line.rect.top + line.rect.height);
      }
    }

    return regions.map((r) => {
      const width = Math.max(0, r.maxX - r.minX);
      const height = Math.max(0, r.bottom - r.top);
      const rect: Rect = { left: r.minX, top: r.top, width, height };
      const hardOverlap = hard.some((o) => this.intersectionArea(rect, o) > 0);
      const softOverlapArea = soft.reduce((acc, o) => acc + this.intersectionArea(rect, o), 0);
      const softOverlapThreshold = Math.max(2, (this.stats?.medianHeight || 12) ** 2 * 0.2);
      const overlap = hardOverlap || softOverlapArea > softOverlapThreshold;
      return {
        lines: r.lines,
        paragraphs: [],
        rect,
        minX: r.minX,
        maxX: r.maxX,
        top: r.top,
        bottom: r.bottom,
        flowAllowed: false,
        overlapsObstacle: overlap,
        nearestObstacleDistance: this.obstacles.nearestDistance(rect, soft)
      };
    });
  }

  private buildParagraphs(region: TextRegion): TextRegion['paragraphs'] {
    const orderedLines = [...region.lines].sort((a, b) => {
      const yDiff = a.rect.top - b.rect.top;
      if (Math.abs(yDiff) > 0.5) return yDiff;
      return a.minX - b.minX;
    });

    const paragraphs: TextRegion['paragraphs'] = [];
    const paragraphGap = Math.max(4, (this.stats?.medianHeight || 12) * 0.8);
    const indentBreak = Math.max(10, (this.stats?.medianHeight || 12) * 1.2);

    const lineToText = (line: TextLine): string => this.reconstructLineText(line.items);

    const mergeHyphenation = (a: string, b: string): { mergedA: string; mergedB: string; joined: boolean } => {
      const aTrim = a.replace(/\s+$/g, '');
      const bTrim = b.replace(/^\s+/g, '');

      if (aTrim.length === 0 || bTrim.length === 0) {
        return { mergedA: aTrim, mergedB: bTrim, joined: false };
      }

      const aEndsWithSoftHyphen = /\u00AD$/.test(aTrim);
      if (!aEndsWithSoftHyphen) {
        return { mergedA: aTrim, mergedB: bTrim, joined: false };
      }

      const nextStartsLower = /^[a-z]/.test(bTrim);
      const prevEndsAlpha = /[A-Za-z]$/.test(aTrim.slice(0, -1));
      if (nextStartsLower && prevEndsAlpha) {
        return {
          mergedA: aTrim.slice(0, -1),
          mergedB: bTrim,
          joined: true
        };
      }

      return { mergedA: aTrim, mergedB: bTrim, joined: false };
    };

    const mergeLineBreakContinuation = (a: string, b: string): { mergedA: string; mergedB: string; joined: boolean } => {
      const aTrim = a.replace(/\s+$/g, '');
      const bTrim = b.replace(/^\s+/g, '');

      if (aTrim.length === 0 || bTrim.length === 0) {
        return { mergedA: aTrim, mergedB: bTrim, joined: false };
      }

      const aEndsWithShortCapPrefix = /[A-Z][a-z]{0,2}$/.test(aTrim);
      const bStartsLowerContinuation = /^[a-z]{3,}/.test(bTrim);
      const aEndsWithPunct = /[\][)(}{,.;:!?]$/.test(aTrim);

      if (aEndsWithShortCapPrefix && bStartsLowerContinuation && !aEndsWithPunct) {
        return { mergedA: aTrim, mergedB: bTrim, joined: true };
      }

      return { mergedA: aTrim, mergedB: bTrim, joined: false };
    };

    let current: TextRegion['paragraphs'][number] | undefined;
    let prevLine: TextLine | undefined;

    for (const line of orderedLines) {
      const indent = Math.max(0, Math.round((line.minX - region.rect.left) * 1000) / 1000);
      const lineTextRaw = lineToText(line);

      if (!current) {
        current = {
          lines: [],
          top: line.rect.top,
          gapBefore: 0,
          dominant: line.items[0],
          lineHeight: Math.max(1, Math.round(line.height))
        };
        paragraphs.push(current);
        current.lines.push({ text: lineTextRaw, indent, sourceLine: line });
        prevLine = line;
        continue;
      }

      const prevBottom = prevLine ? prevLine.rect.top + prevLine.rect.height : current.top;
      const gap = line.rect.top - prevBottom;
      const indentDelta = prevLine ? Math.abs(line.minX - prevLine.minX) : 0;
      const breakByGap = gap > paragraphGap;
      const breakByIndent = indentDelta > indentBreak && gap > Math.max(1, this.stats?.medianHeight ? this.stats.medianHeight * 0.15 : 1);

      if (breakByGap || breakByIndent) {
        current = {
          lines: [],
          top: line.rect.top,
          gapBefore: Math.max(0, Math.round(gap * 1000) / 1000),
          dominant: line.items[0],
          lineHeight: Math.max(1, Math.round(line.height))
        };
        paragraphs.push(current);
        current.lines.push({ text: lineTextRaw, indent, sourceLine: line });
        prevLine = line;
        continue;
      }

      const prevLineEntry = current.lines.length > 0 ? current.lines[current.lines.length - 1] : undefined;
      if (prevLineEntry) {
        const merged = mergeHyphenation(prevLineEntry.text, lineTextRaw);
        if (merged.joined) {
          prevLineEntry.text = merged.mergedA;
          current.lines.push({ text: lineTextRaw, indent, sourceLine: line, joinWithPrev: 'hyphenation' });
          prevLine = line;
          continue;
        }

        const mergedContinuation = mergeLineBreakContinuation(prevLineEntry.text, lineTextRaw);
        if (mergedContinuation.joined) {
          prevLineEntry.text = mergedContinuation.mergedA;
          current.lines.push({ text: lineTextRaw, indent, sourceLine: line, joinWithPrev: 'continuation' });
          prevLine = line;
          continue;
        }
      }

      current.lines.push({ text: lineTextRaw, indent, sourceLine: line });
      prevLine = line;
    }

    return paragraphs;
  }

  private normalizeText(s: string): string {
    if (!s) return s;
    const needsNormalization =
      /\b[A-Z]{2,3}[0-9]{2,4}\b/.test(s) ||
      /\b(to|with|for|and|of|at|in|on|as)[A-Z][a-z]/.test(s) ||
      /[a-z]{4,}(to|with|for|and|of|at|in|on|as)[A-Z][a-z]/.test(s) ||
      /[a-z]{4,}[A-Z][a-z]/.test(s) ||
      /[A-Z][a-z]{2,}[A-Z][a-z]{2,}/.test(s) ||
      /[A-Za-z]{4,}\s+[a-z]{1,2}\b/.test(s);

    if (!needsNormalization) return s;

    let out = s;
    out = out.replace(/\b(to|with|for|and|of|at|in|on|as)([A-Z][a-z])/g, '$1 $2');
    out = out.replace(/([A-Za-z]{4,})\s+([a-z]{1,2})\b/g, '$1$2');
    out = out.replace(/\b([A-Z]{2,3})([0-9]{2,4})\b/g, '$1 $2');
    out = out.replace(/([A-Za-z]{4,})(to|with|for|and|of|at|in|on|as)(?=[A-Z][a-z])/g, '$1 $2');
    out = out.replace(/([a-z]{4,})([A-Z][a-z])/g, '$1 $2');
    out = out.replace(/([A-Z][a-z]{2,})([A-Z][a-z]{2,})/g, '$1 $2');

    const stopwordParts = new Set(['if', 'to', 'for', 'with', 'and', 'of', 'in', 'on', 'at', 'as', 'or', 'an', 'a', 'the', 'be', 'we', 'us', 'my', 'me', 'do', 'no']);
    out = out.replace(/\b(?:[a-z]{1,3}\s+){1,}[a-z]{1,3}\b/g, (m) => {
      const parts = m.split(/\s+/g).filter(Boolean);
      if (parts.length < 2) return m;
      if (!parts.every((p) => /^[a-z]{1,3}$/.test(p))) return m;
      const totalLen = parts.reduce((acc, p) => acc + p.length, 0);
      if (totalLen < 4) return m;
      if (stopwordParts.has(parts[0] || '')) return m;
      return parts.join('');
    });

    out = out.replace(/\s{2,}/g, ' ');
    return out;
  }

  private intersectionArea(a: Rect, b: Rect): number {
    const x1 = Math.max(a.left, b.left);
    const y1 = Math.max(a.top, b.top);
    const x2 = Math.min(a.left + a.width, b.left + b.width);
    const y2 = Math.min(a.top + a.height, b.top + b.height);

    const w = x2 - x1;
    const h = y2 - y1;
    if (w <= 0 || h <= 0) return 0;
    return w * h;
  }

  private isStableLineHeight(lines: TextLine[]): boolean {
    if (!this.stats || lines.length <= 1) return true;

    const heights = lines.map((l) => l.height).sort((a, b) => a - b);
    const minH = heights[0] || this.stats.medianHeight;
    const maxH = heights[heights.length - 1] || this.stats.medianHeight;

    return maxH <= Math.max(minH + 4, this.stats.medianHeight * 1.4);
  }

  private isStableIndent(lines: TextLine[]): boolean {
    if (!this.stats || lines.length <= 2) return true;

    const lefts = lines.map((l) => l.minX).sort((a, b) => a - b);
    const p10 = lefts[Math.floor(lefts.length * 0.1)] ?? lefts[0] ?? 0;
    const p90 = lefts[Math.floor(lefts.length * 0.9)] ?? lefts[lefts.length - 1] ?? 0;

    return (p90 - p10) <= Math.max(18, this.stats.medianFontSize * 2.5);
  }
}
