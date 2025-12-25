import type {
  HTMLOutput,
  HTMLGenerationOptions,
  CSSOptions,
  OutputMetadata
} from '../types/output.js';
import type { PDFDocument, PDFPage, PDFGraphicsContent, PDFFormContent, PDFAnnotation, PDFTextContent, PDFFontMetrics } from '../types/pdf.js';
import type { FontMapping, FontMetrics } from '../types/fonts.js';
import { CSSGenerator } from './css-generator.js';
import { LayoutEngine } from './layout-engine.js';
import { RegionLayoutAnalyzer } from '../core/region-layout.js';
import { SemanticHTMLGenerator } from './semantic-html-generator.js';
import { normalizeFontName } from '../fonts/font-name-normalizer.js';
import { adaptAbsoluteToFlex } from './layout-adapter.js';
import { getDefaultFontMetricsResolver } from '../fonts/font-metrics-resolver.js';
import { getDefaultWordValidator } from '../core/text-pipeline/word-validator.js';
import { getDefaultPredictiveModel } from '../core/text-pipeline/predictive-model.js';

type LineToken =
  | { type: 'text'; text: string; sample: PDFTextContent }
  | { type: 'space' };

export class HTMLGenerator {
  private cssGenerator: CSSGenerator;
  private layoutEngine: LayoutEngine;
  private options: HTMLGenerationOptions;
  private regionLayoutAnalyzer: RegionLayoutAnalyzer;
  private semanticHtmlGenerator: SemanticHTMLGenerator;
  private extraCssRules: string[] = [];
  private flowStyleClassByKey: Map<string, string> = new Map();
  private absGapCssInjected: boolean = false;
  private wordValidator = getDefaultWordValidator();
  private predictiveModel = getDefaultPredictiveModel();

  private static OUTLINE_LIST_MARKERS: Array<{ pattern: RegExp; listType: 'ul' | 'ol' }> = [
    { pattern: /^[•●○■□◆◇▪▫]\s+/, listType: 'ul' },
    { pattern: /^[-–—]\s+/, listType: 'ul' },
    { pattern: /^\(?\d+[.)\]]\s+/, listType: 'ol' },
    { pattern: /^\(?[A-Za-z][.)\]]\s+/, listType: 'ol' },
    { pattern: /^\(?[ivxIVX]+[.)\]]\s+/, listType: 'ol' }
  ];

  constructor(
    options: HTMLGenerationOptions,
    cssOptions: CSSOptions = { includeFonts: true, includeReset: true, includePrint: true }
  ) {
    this.options = options;
    this.cssGenerator = new CSSGenerator(options, cssOptions);
    this.layoutEngine = new LayoutEngine(options);
    this.regionLayoutAnalyzer = new RegionLayoutAnalyzer({
      textPipeline: options.textPipeline ?? 'legacy',
      textClassifierProfile: options.textClassifierProfile,
      lineGroupingFontSizeFactor: options.layoutTuning?.lineGroupingFontSizeFactor
    });
    this.semanticHtmlGenerator = new SemanticHTMLGenerator();
  }

  generate(
    document: PDFDocument,
    fontMappings: FontMapping[],
    metadata: OutputMetadata
  ): HTMLOutput {
    this.extraCssRules = [];
    this.flowStyleClassByKey.clear();
    this.absGapCssInjected = false;
    this.layoutEngine.resetCssCaches();

    const html = this.generateHTML(document, fontMappings);
    const css = this.generateCSS(fontMappings, document.pages);
    const fonts = this.extractFontFamilies(fontMappings);
    const text = this.options.includeExtractedText ? this.extractDocumentText(document) : undefined;

    return {
      html: this.formatOutput(html, css),
      css,
      metadata,
      fonts,
      text
    };
  }

  private generateHTML(
    document: PDFDocument,
    fontMappings: FontMapping[]
  ): string {
    const parts: string[] = [];

    parts.push('<!DOCTYPE html>');
    parts.push('<html lang="en">');
    parts.push('<head>');
    parts.push('<meta charset="UTF-8">');
    parts.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
    parts.push(`<title>${document.metadata.title || 'PDF Document'}</title>`);

    if (this.options.format === 'html+css') {
      parts.push('<link rel="stylesheet" href="styles.css">');
    } else if (this.options.format === 'html+inline-css') {
      // CSS will be inlined in formatOutput
    }

    parts.push('</head>');
    parts.push('<body>');
    parts.push('<div class="pdf-content">');

    // Ensure all pages are included, even if empty
    if (document.pages.length !== document.pageCount) {
      console.warn(`Page count mismatch: expected ${document.pageCount} pages, but document.pages has ${document.pages.length} pages`);
    }

    for (let i = 0; i < document.pageCount; i++) {
      const page = document.pages[i];
      if (!page) {
        console.error(`Page ${i} is missing from document.pages array`);
        // Create a placeholder page to maintain page numbering
        const placeholderPage: PDFPage = {
          pageNumber: i,
          width: 612, // Standard US Letter width
          height: 792, // Standard US Letter height
          content: {
            text: [],
            images: [],
            graphics: [],
            forms: [],
            annotations: []
          }
        };
        parts.push(this.generatePageHTML(placeholderPage, fontMappings));
      } else {
        parts.push(this.generatePageHTML(page, fontMappings));
      }
    }

    parts.push('</div>');
    parts.push('</body>');
    parts.push('</html>');

    return parts.join('\n');
  }

  private applyUnderlineGraphicsToText(page: PDFPage): void {
    const graphics = page.content.graphics || [];
    const texts = page.content.text || [];
    if (graphics.length === 0 || texts.length === 0) return;

    type TextRect = {
      idx: number;
      left: number;
      right: number;
      top: number;
      bottom: number;
      height: number;
    };

    const textRects: TextRect[] = texts
      .map((t, idx): TextRect | null => {
        if (!t || typeof t.x !== 'number' || typeof t.y !== 'number') return null;
        const w = (typeof t.width === 'number' && Number.isFinite(t.width) && t.width > 0) ? t.width : this.estimateTextWidth(t);
        const h = (typeof t.height === 'number' && Number.isFinite(t.height) && t.height > 0) ? t.height : Math.max(1, t.fontSize || 12);
        const abs = this.layoutEngine.transformCoordinates(t.x, t.y, page.height, h);
        const left = abs.x;
        const top = abs.y;
        return {
          idx,
          left,
          right: left + Math.max(0, w),
          top,
          bottom: top + Math.max(0, h),
          height: Math.max(1, h)
        };
      })
      .filter((t): t is TextRect => Boolean(t));

    if (textRects.length === 0) return;

    const removed = new Set<number>();

    for (let gi = 0; gi < graphics.length; gi++) {
      const g = graphics[gi];
      if (!g) continue;

      const bounds = this.getGraphicBounds(g);
      if (!bounds) continue;

      const width = bounds.maxX - bounds.minX;
      const strokeW = typeof g.strokeWidth === 'number' && Number.isFinite(g.strokeWidth) ? Math.abs(g.strokeWidth) : 1;
      const height = Math.max(bounds.maxY - bounds.minY, strokeW);

      const maxThickness = Math.max(6.5, strokeW * 4.0);
      const minLen = Math.max(2, page.width * 0.003);
      if (width < minLen) continue;
      if (height > maxThickness) continue;
      if (width / Math.max(0.35, height) < 8) continue;

      const underlineY = (bounds.minY + bounds.maxY) / 2;

      const matches: Array<{ tr: TextRect; segStart: number; segEnd: number }> = [];

      for (const tr of textRects) {
        const segStart = Math.max(bounds.minX, tr.left);
        const segEnd = Math.min(bounds.maxX, tr.right);
        const overlapX = segEnd - segStart;
        if (overlapX <= 0) continue;

        const textWidth = Math.max(1, tr.right - tr.left);
        const overlapRatio = overlapX / Math.max(1, Math.min(width, textWidth));
        if (overlapRatio < 0.2) continue;

        const tolUp = Math.max(0.8, tr.height * 0.12);
        const tolDown = Math.max(1.5, tr.height * 0.65);
        const dy = underlineY - tr.bottom;
        if (dy < -tolUp || dy > tolDown) continue;

        matches.push({ tr, segStart, segEnd });
      }

      if (matches.length === 0) continue;

      // Avoid converting table/grid borders: require reasonable text coverage along the underline length.
      const segments = matches
        .map((m) => [m.segStart, m.segEnd] as const)
        .sort((a, b) => a[0] - b[0]);
      let union = 0;
      let curStart = segments[0]![0];
      let curEnd = segments[0]![1];
      for (let i = 1; i < segments.length; i++) {
        const [s, e] = segments[i]!;
        if (s <= curEnd) {
          curEnd = Math.max(curEnd, e);
        } else {
          union += Math.max(0, curEnd - curStart);
          curStart = s;
          curEnd = e;
        }
      }
      union += Math.max(0, curEnd - curStart);

      const textSpanMin = Math.min(...matches.map((m) => m.tr.left));
      const textSpanMax = Math.max(...matches.map((m) => m.tr.right));
      const textSpanWidth = Math.max(1, textSpanMax - textSpanMin);
      const coverageOnUnderline = union / Math.max(1, width);
      const coverageOnSpan = union / textSpanWidth;

      const underlineToTextSpan = width / Math.max(1, textSpanWidth);
      const looksLikeFillLine = width >= page.width * 0.25 && underlineToTextSpan >= 1.8;
      if (looksLikeFillLine) continue;

      const looksLikeLongSeparator = width >= page.width * 0.45 && coverageOnUnderline < 0.5 && coverageOnSpan < 0.65;
      if (looksLikeLongSeparator) continue;

      for (const m of matches) {
        const t = texts[m.tr.idx];
        if (t && t.textDecoration !== 'underline') {
          (t as unknown as { textDecoration?: PDFTextContent['textDecoration'] }).textDecoration = 'underline';
        }
      }

      removed.add(gi);
    }

    if (removed.size > 0) {
      page.content.graphics = graphics.filter((_, i) => !removed.has(i));
    }
  }

  private getGraphicBounds(graphic: PDFGraphicsContent): { minX: number; minY: number; maxX: number; maxY: number } | null {
    if (graphic.type === 'path' && typeof graphic.path === 'string' && graphic.path.length > 0) {
      return this.getPathBounds(graphic.path);
    }

    if ((graphic.type === 'rectangle' || graphic.type === 'line') &&
      typeof graphic.x === 'number' &&
      typeof graphic.y === 'number' &&
      typeof graphic.width === 'number' &&
      typeof graphic.height === 'number') {
      const x1 = graphic.x;
      const y1 = graphic.y;
      const x2 = graphic.x + graphic.width;
      const y2 = graphic.y + graphic.height;
      return {
        minX: Math.min(x1, x2),
        minY: Math.min(y1, y2),
        maxX: Math.max(x1, x2),
        maxY: Math.max(y1, y2)
      };
    }

    return null;
  }

  private getPathBounds(path: string): { minX: number; minY: number; maxX: number; maxY: number } | null {
    const matches = path.match(/-?\d*\.?\d+(?:e[+-]?\d+)?/gi);
    if (!matches || matches.length < 4) return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let i = 0; i + 1 < matches.length; i += 2) {
      const x = Number(matches[i]);
      const y = Number(matches[i + 1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
      return null;
    }
    return { minX, minY, maxX, maxY };
  }

  private computeLineBoxFromRuns(
    runs: PDFTextContent[],
    pageHeight: number,
    regionTop: number,
    absLineHeightFactor: number
  ): { lineTopRel: number; lineHeight: number; lineBottomRel: number } {
    let minTop = Number.POSITIVE_INFINITY;
    let maxBottom = Number.NEGATIVE_INFINITY;

    for (const r of runs) {
      if (!r || typeof r.x !== 'number' || typeof r.y !== 'number') continue;
      const h = Math.max(1, this.normalizeCoord(this.calculateVisualHeight(r, absLineHeightFactor)));
      const abs = this.layoutEngine.transformCoordinates(r.x, r.y, pageHeight, h);
      const top = abs.y;
      const bottom = top + h;
      if (top < minTop) minTop = top;
      if (bottom > maxBottom) maxBottom = bottom;
    }

    if (!Number.isFinite(minTop) || !Number.isFinite(maxBottom) || maxBottom <= minTop) {
      return { lineTopRel: 0, lineHeight: 1, lineBottomRel: 1 };
    }

    const lineTopRel = this.normalizeCoord(minTop - regionTop);
    const lineHeight = Math.max(1, this.normalizeCoord(maxBottom - minTop));
    const lineBottomRel = this.normalizeCoord(lineTopRel + lineHeight);
    return { lineTopRel, lineHeight, lineBottomRel };
  }

  private generatePositionedSemanticText(page: PDFPage, fontMappings: FontMapping[]): string {
    return this.generateSemanticPositionedText(page, fontMappings);
  }

  private generateSemanticPositionedText(page: PDFPage, fontMappings: FontMapping[]): string {
    // Use flexbox layout if enabled, otherwise fall back to absolute positioning
    if (this.options.useFlexboxLayout !== false) {
      return this.generateFlexboxSemanticText(page, fontMappings);
    }
    return this.generateAbsoluteSemanticText(page, fontMappings);
  }

  /**
   * Normalize coordinate to 3 decimal places (0.001px precision)
   * Same precision as preserve fidelity pipeline
   */
  private normalizeCoord(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private normalizePdfFontMetrics(metrics: PDFFontMetrics): FontMetrics {
    const m = metrics as unknown as Record<string, unknown>;
    return {
      ascent: Number(m.ascent ?? 0),
      descent: Number(m.descent ?? 0),
      capHeight: Number(m.capHeight ?? 0),
      xHeight: Number(m.xHeight ?? 0),
      averageWidth: Number(m.averageWidth ?? 0),
      maxWidth: Number(m.maxWidth ?? 0),
      unitsPerEm: 1000
    };
  }

  /**
   * Estimate text width if not provided by PDF
   * Uses same approach as preserve layout pipeline
   * Note: ImprovedTextMerger already calculates accurate widths, so this is mainly a fallback
   */
  private estimateTextWidth(run: PDFTextContent): number {
    // Priority 1: Use actual PDF width if available (most accurate)
    // ImprovedTextMerger already calculates this from PDF coordinates
    if (run.width && run.width > 0) {
      return run.width;
    }
    
    // Priority 2: Use font metrics resolver if font info is available
    if (run.fontInfo) {
      try {
        const resolver = getDefaultFontMetricsResolver();
        const match = resolver.resolveDetectedFont({
          name: run.fontInfo.name,
          family: run.fontFamily || run.fontInfo.name,
          weight: run.fontWeight || 400,
          style: run.fontStyle || 'normal',
          embedded: run.fontInfo.embedded || false,
          metrics: this.normalizePdfFontMetrics(run.fontInfo.metrics),
          encoding: run.fontInfo.encoding
        });
        
        const fontSize = run.fontSize || 12;
        const text = run.text || '';
        let totalWidth = 0;
        
        for (let i = 0; i < text.length; i++) {
          const ch = text[i]!;
          const charWidth = resolver.estimateCharWidthPx(ch, match.record, fontSize);
          totalWidth += charWidth;
        }
        
        if (totalWidth > 0) {
          return totalWidth;
        }
      } catch (error) {
        // Fall through to heuristic if font metrics fail
      }
    }
    
    // Priority 3: Fallback heuristic - improved calculation
    const fontSize = run.fontSize || 12;
    const text = (run.text || '').trim();
    
    if (text.length === 0) return 0;
    
    // Improved heuristic: account for different character types
    // Numbers and uppercase are wider, lowercase and punctuation are narrower
    let estimatedWidth = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      let charWidthFactor = 0.55; // Default for lowercase
      
      if (/[0-9]/.test(ch)) {
        charWidthFactor = 0.52; // Numbers slightly narrower
      } else if (/[A-Z]/.test(ch)) {
        charWidthFactor = 0.58; // Uppercase wider
      } else if (/[a-z]/.test(ch)) {
        charWidthFactor = 0.55; // Lowercase
      } else if (/[,.;:!?'"()]/.test(ch)) {
        charWidthFactor = 0.30; // Punctuation much narrower
      } else if (ch === ' ') {
        charWidthFactor = 0.30; // Spaces narrower
      } else if (/[iIlL1|]/.test(ch)) {
        charWidthFactor = 0.25; // Narrow characters
      } else if (/[mwMW]/.test(ch)) {
        charWidthFactor = 0.75; // Wide characters
      }
      
      estimatedWidth += fontSize * charWidthFactor;
    }
    
    return Math.max(1, estimatedWidth);
  }

  /**
   * Calculate visual height for text element
   * Uses same approach as preserve layout pipeline
   */
  private calculateVisualHeight(run: PDFTextContent, absLineHeightFactor: number): number {
    const fontSize = run.fontSize || 12;
    const pdfHeight = run.height || 0;
    const calculatedHeight = fontSize * absLineHeightFactor;
    return Math.max(pdfHeight, calculatedHeight);
  }

  /**
   * Detect nearby whitespace around a text run and calculate padding
   * This helps prevent cramped text by adding breathing room
   * Uses intelligent detection based on gap size, font metrics, and text context
   */
  private detectWhitespacePadding(
    run: PDFTextContent,
    prevRun: PDFTextContent | null,
    nextRun: PDFTextContent | null,
    fontSize: number
  ): { paddingLeft: number; paddingRight: number; widthAdjustment: number } {
    let paddingLeft = 0;
    let paddingRight = 0;
    let widthAdjustment = 0;

    if (this.options.semanticPositionedLayout?.whitespacePadding === false) {
      return { paddingLeft, paddingRight, widthAdjustment };
    }

    const firstNonSpace = (s: string): string => {
      const m = s.match(/\S/u);
      return m ? m[0]! : '';
    };
    const lastNonSpace = (s: string): string => {
      const m = s.match(/\S(?=\s*$)/u);
      return m ? m[0]! : '';
    };
    const isAlphaNum = (ch: string): boolean => /[\p{L}\p{N}]/u.test(ch);
    const isOpener = (ch: string): boolean => /[([{"'\u2018\u201C]/u.test(ch);
    const isCloser = (ch: string): boolean => /[)\]}"'\u2019\u201D]/u.test(ch);
    const isTightPunct = (ch: string): boolean => /[,.;:!?]/u.test(ch);

    const text = (run.text || '').trim();
    const textLength = text.length;

    // Detect whitespace before this run
    if (prevRun) {
      const gapBefore = run.x - (prevRun.x + prevRun.width);
      const prevText = (prevRun.text || '').trim();
      const prevFontSize = prevRun.fontSize || fontSize;
      const combinedFontSize = Math.max(1, (prevFontSize + fontSize) / 2);
      
      // Calculate character width estimate for gap analysis
      const estimatedCharWidth = combinedFontSize * 0.55;
      const gapByChar = gapBefore / Math.max(0.01, estimatedCharWidth);
      
      // Small gaps (< 0.4 * fontSize) are often visual whitespace within words/phrases
      // Medium gaps (0.4-0.7 * fontSize) might be tight word spacing that needs padding
      if (gapBefore > 0) {
        if (gapBefore < combinedFontSize * 0.25) {
          // Very small gap - likely part of visual text area, add padding
          paddingLeft = Math.min(gapBefore * 0.6, combinedFontSize * 0.12);
        } else if (gapBefore < combinedFontSize * 0.5 && gapByChar < 0.5) {
          // Small gap that's less than half a character - add moderate padding
          paddingLeft = Math.min(gapBefore * 0.4, combinedFontSize * 0.08);
        } else if (gapBefore < combinedFontSize * 0.7 && gapByChar < 0.7) {
          // Medium gap - might need slight padding for visual breathing room
          // Only if it's not clearly a word break
          const isWordBreak = gapByChar >= 0.85 || 
            (/[A-Za-z]$/.test(prevText) && /^[A-Z]/.test(text)) ||
            (/[a-z]$/.test(prevText) && /^[A-Z]/.test(text));
          if (!isWordBreak) {
            paddingLeft = Math.min(gapBefore * 0.2, combinedFontSize * 0.05);
          }
        }
        
        paddingLeft = this.normalizeCoord(paddingLeft);
      }

      const prevEnd = lastNonSpace(prevRun.text || '');
      const curStart = firstNonSpace(run.text || '');
      const tight =
        (isOpener(prevEnd) && isAlphaNum(curStart)) ||
        (prevEnd === '-' && isAlphaNum(curStart)) ||
        (isAlphaNum(prevEnd) && (isCloser(curStart) || isTightPunct(curStart))) ||
        (isOpener(prevEnd) && (isCloser(curStart) || isTightPunct(curStart)));
      if (tight) paddingLeft = 0;
    }

    // Detect whitespace after this run
    if (nextRun) {
      const gapAfter = nextRun.x - (run.x + run.width);
      const nextText = (nextRun.text || '').trim();
      const nextFontSize = nextRun.fontSize || fontSize;
      const combinedFontSize = Math.max(1, (fontSize + nextFontSize) / 2);
      
      // Calculate character width estimate for gap analysis
      const estimatedCharWidth = combinedFontSize * 0.55;
      const gapByChar = gapAfter / Math.max(0.01, estimatedCharWidth);
      
      // Similar logic for trailing whitespace
      if (gapAfter > 0) {
        if (gapAfter < combinedFontSize * 0.25) {
          // Very small gap - likely part of visual text area
          paddingRight = Math.min(gapAfter * 0.6, combinedFontSize * 0.12);
        } else if (gapAfter < combinedFontSize * 0.5 && gapByChar < 0.5) {
          // Small gap
          paddingRight = Math.min(gapAfter * 0.4, combinedFontSize * 0.08);
        } else if (gapAfter < combinedFontSize * 0.7 && gapByChar < 0.7) {
          // Medium gap - check if it's a word break
          const isWordBreak = gapByChar >= 0.85 ||
            (/[A-Za-z]$/.test(text) && /^[A-Z]/.test(nextText)) ||
            (/[a-z]$/.test(text) && /^[A-Z]/.test(nextText)) ||
            /^[,.;:!?)]/.test(nextText);
          if (!isWordBreak) {
            paddingRight = Math.min(gapAfter * 0.2, combinedFontSize * 0.05);
          }
        }
        
        paddingRight = this.normalizeCoord(paddingRight);
      }

      const curEnd = lastNonSpace(run.text || '');
      const nextStart = firstNonSpace(nextRun.text || '');
      const tight =
        (isOpener(curEnd) && isAlphaNum(nextStart)) ||
        (curEnd === '-' && isAlphaNum(nextStart)) ||
        (isAlphaNum(curEnd) && (isCloser(nextStart) || isTightPunct(nextStart))) ||
        (isOpener(curEnd) && (isCloser(nextStart) || isTightPunct(nextStart)));
      if (tight) paddingRight = 0;
    }

    // If run width seems too narrow compared to text content, add small width adjustment
    // This helps with cramped rendering, especially for runs with missing width data
    if (textLength > 0) {
      if (run.width && run.width > 0) {
        // Use font metrics if available for better estimation
        let estimatedMinWidth = 0;
        try {
          const resolver = getDefaultFontMetricsResolver();
          if (run.fontInfo) {
            const match = resolver.resolveDetectedFont({
              name: run.fontInfo.name,
              family: run.fontFamily || run.fontInfo.name,
              weight: run.fontWeight || 400,
              style: run.fontStyle || 'normal',
              embedded: run.fontInfo.embedded || false,
              metrics: this.normalizePdfFontMetrics(run.fontInfo.metrics),
              encoding: run.fontInfo.encoding
            });
            
            for (let i = 0; i < text.length; i++) {
              const ch = text[i]!;
              estimatedMinWidth += resolver.estimateCharWidthPx(ch, match.record, fontSize);
            }
          }
        } catch {
          // Fall through to heuristic
        }
        
        // Fallback to heuristic if font metrics not available
        if (estimatedMinWidth === 0) {
          estimatedMinWidth = textLength * fontSize * 0.45; // Conservative estimate
        }
        
        // If actual width is significantly less than estimated, add adjustment
        if (run.width < estimatedMinWidth * 0.9) {
          widthAdjustment = Math.min((estimatedMinWidth - run.width) * 0.3, fontSize * 0.15);
          widthAdjustment = this.normalizeCoord(widthAdjustment);
        }
      } else {
        // No width data - add small adjustment to prevent cramped text
        widthAdjustment = Math.min(fontSize * 0.08, 2);
        widthAdjustment = this.normalizeCoord(widthAdjustment);
      }
    }

    return { paddingLeft, paddingRight, widthAdjustment };
  }

  /**
   * Use lexical models (dictionary + n-grams) to improve word boundaries
   * in already-merged text runs.
   *
   * This is deliberately conservative and only inserts spaces *inside*
   * long alphabetic sequences when the dictionary suggests strong
   * boundaries and the n-gram model prefers the split.
   */
  private enhanceRunsWithLexicalModel(runs: PDFTextContent[]): PDFTextContent[] {
    if (!runs || runs.length === 0) return runs;

    const validator = this.wordValidator;
    const model = this.predictiveModel;

    const enhanceText = (text: string): string => {
      const raw = text || '';
      const trimmed = raw.trim();
      if (trimmed.length < 8) return raw;

      // Only operate on mostly alphabetic sequences without many spaces
      const letters = trimmed.replace(/[^A-Za-z]/g, '').length;
      const spaceCount = (trimmed.match(/\s+/g) || []).length;
      const alphaRatio = letters / Math.max(1, trimmed.length);
      if (alphaRatio < 0.65 || spaceCount >= Math.max(1, trimmed.length / 12)) return raw;

      // Work on a pure A-Z string (strip punctuation/digits) for boundary suggestions
      const compact = trimmed.replace(/[^A-Za-z]+/g, '');
      if (compact.length < 8) return raw;

      const suggestions = validator.suggestBoundaries(compact);
      if (!suggestions || suggestions.length === 0) return raw;

      const boundaryPositions = Array.from(
        new Set(
          suggestions
            .filter((s) => s.position > 1 && s.position < compact.length - 1 && s.confidence >= 0.7)
            .map((s) => s.position)
        )
      ).sort((a, b) => a - b);

      if (boundaryPositions.length === 0) return raw;

      const parts: string[] = [];
      let start = 0;
      for (const pos of boundaryPositions) {
        parts.push(compact.slice(start, pos));
        start = pos;
      }
      parts.push(compact.slice(start));

      // Validate parts: avoid creating obvious gibberish
      const validParts = parts.filter((p) => p.length > 0);
      if (validParts.length <= 1) return raw;

      let completeOrPrefix = 0;
      for (const p of validParts) {
        const res = validator.validate(p);
        if (res === 'complete' || res === 'prefix') completeOrPrefix += 1;
      }

      const lexicalCoverage = completeOrPrefix / validParts.length;
      if (lexicalCoverage < 0.4) return raw;

      // Compare n-gram likelihood: prefer split only if tokens look better
      const joinedScore = model.scoreWordLikelihood(compact);
      const splitScore = validParts.reduce((acc, p) => acc + model.scoreWordLikelihood(p), 0) / validParts.length;
      if (splitScore <= joinedScore + 0.02) return raw;

      // Reconstruct with spaces; preserve original leading/trailing whitespace
      const rebuiltCore = validParts.join(' ');
      const leadingWs = raw.match(/^\s+/)?.[0] ?? '';
      const trailingWs = raw.match(/\s+$/)?.[0] ?? '';
      return leadingWs + rebuiltCore + trailingWs;
    };

    return runs.map((run) => {
      const text = run.text || '';
      const enhanced = enhanceText(text);
      if (enhanced === text) return run;
      return { ...run, text: enhanced };
    });
  }

  private generateFlexboxSemanticText(page: PDFPage, fontMappings: FontMapping[]): string {
    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const absLineHeightFactor = this.options.layoutTuning?.absLineHeightFactor ?? 1.25;
    const minGapPx = 0.5;
    const mergeSameStyleLines = this.options.semanticPositionedLayout?.mergeSameStyleLines === true;

    const aggressiveMerge = (items: PDFTextContent[]): PDFTextContent[] => {
      if (items.length <= 1) return items;
      const sorted = [...items].sort((a, b) => a.x - b.x);
      const merged: PDFTextContent[] = [];
      let current: PDFTextContent | null = null;
      
      // Helper to estimate width based on text and font size
      const estimateWidth = (item: PDFTextContent): number => {
        const text = (item.text || '').replace(/\s+/g, '');
        if (text.length === 0) return item.width || 0;
        // If width is available and reasonable, use it
        if (item.width && item.width > 0 && item.width > text.length * item.fontSize * 0.1) {
          return item.width;
        }
        // Otherwise estimate: average char is ~0.5 of font size
        return text.length * item.fontSize * 0.5;
      };

      const isShortAlphaFragment = (s: string): boolean => /^[A-Za-z]{1,3}$/.test((s || '').trim());
      
      for (const item of sorted) {
        if (!current) {
          current = { ...item };
          continue;
        }
        
        // Normalize font families for comparison
        const curFont = (current.fontFamily || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const itemFont = (item.fontFamily || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        // Check if same font family
        const sameFont = curFont === itemFont;
        
        // Calculate gap using estimated width to handle PDFium width issues
        const curWidthEst = estimateWidth(current);
        const curWidthForGap = (current.width && current.width > 0 && current.width <= curWidthEst * 1.25)
          ? current.width
          : curWidthEst;
        const gap = item.x - (current.x + curWidthForGap);
        const avgFontSize = Math.max((current.fontSize + item.fontSize) / 2, 6);

        const baselineTol = Math.max(1, avgFontSize * 0.6);
        const sameBaseline = Math.abs((current.y || 0) - (item.y || 0)) <= baselineTol;

        const minFs = Math.max(1, Math.min(current.fontSize || 1, item.fontSize || 1));
        const maxFs = Math.max(1, Math.max(current.fontSize || 1, item.fontSize || 1));
        const fontRatioOk = maxFs / minFs <= 1.9;
        
        // Check if items look fragmented (short text segments)
        const curLen = (current.text || '').trim().length;
        const itemLen = (item.text || '').trim().length;
        const looksFragmented = curLen <= 15 || itemLen <= 8;
        
        // Aggressive merge conditions for same-font items on same line
        // Be VERY aggressive for fragmented text on same line
        const shouldMerge = sameFont && sameBaseline && fontRatioOk && (
          // Overlapping or negative gap - always merge
          gap < 0 ||
          // Very small gap (kerning) - always merge
          gap < avgFontSize * 0.5 ||
          // Fragmented text with reasonable gap - up to 4x font size
          (looksFragmented && gap < avgFontSize * 4) ||
          // Normal text with moderate gap
          (!looksFragmented && gap < avgFontSize * 2)
        );
        
        if (shouldMerge) {
          // Determine if we need a space between
          // Insert space if gap is significant OR if current ends with letter and next starts with letter
          const curText = current.text || '';
          const itemText = item.text || '';
          const curEndsAlpha = /[a-zA-Z]$/.test(curText);
          const itemStartsAlpha = /^[a-zA-Z]/.test(itemText);
          const curEndsLower = /[a-z]$/.test(curText);
          const itemStartsUpper = /^[A-Z]/.test(itemText);
          const isCaseBoundary = curEndsLower && itemStartsUpper;
          
          // Be more aggressive about inserting spaces between words
          // Lower threshold from 0.25 to 0.15 for general gaps
          // Lower threshold from 0.65 to 0.35 for alpha-to-alpha
          // Case boundaries (lower->Upper) almost always need a space
          const needsSpace = (
            // Case boundary with any positive gap - very likely a word break
            (isCaseBoundary && gap > avgFontSize * 0.05) ||
            // General gap threshold - lowered for better word separation
            (gap > avgFontSize * 0.15 &&
            !/[([{]$/.test(curText) &&
            !/^[)\]},.:;!?]/.test(itemText) &&
            !(isShortAlphaFragment(curText.slice(-3)) && isShortAlphaFragment(itemText.slice(0, 3))))
          ) || (
            // Alpha-to-alpha with moderate gap - lowered threshold
            curEndsAlpha && itemStartsAlpha && gap > avgFontSize * 0.35 &&
            !(isShortAlphaFragment(curText.slice(-3)) && isShortAlphaFragment(itemText.slice(0, 3)))
          );
          
          current.text = curText + (needsSpace ? ' ' : '') + itemText;
          const itemWidthEst = estimateWidth(item);
          const itemWidthForEnd = (item.width && item.width > 0 && item.width <= itemWidthEst * 1.25) ? item.width : itemWidthEst;
          const endX = Math.max(current.x + curWidthForGap, item.x + itemWidthForEnd);
          current.width = endX - current.x;
          current.height = Math.max(current.height, item.height);
          // Use the larger font size for the merged run
          current.fontSize = Math.max(current.fontSize, item.fontSize);
          current.y = ((current.y || 0) * (current.fontSize || 1) + (item.y || 0) * (item.fontSize || 1)) / Math.max(1, (current.fontSize || 1) + (item.fontSize || 1));
        } else {
          merged.push(current);
          current = { ...item };
        }
      }
      
      if (current) merged.push(current);
      return merged;
    };
    
    const getMergedRunsForLine = (line: (typeof analysis.regions)[number]['lines'][number]): PDFTextContent[] => {
      const initialMerge = line.mergedRuns && line.mergedRuns.length > 0
        ? line.mergedRuns.map((run): PDFTextContent => ({
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
            textDecoration: run.textDecoration,
            rotation: run.rotation,
            fontInfo: undefined
          }))
        : this.mergeTextRuns(line.items);
      
      // Apply second-pass aggressive merge to fix remaining fragmentation
      const merged = aggressiveMerge(initialMerge);
      // Then run a conservative lexical enhancement pass to insert
      // missing word boundaries inside long alphabetic sequences.
      const enhanced = this.enhanceRunsWithLexicalModel(merged);
      
      // Apply post-processing to fix merged words like "connectingfinance" -> "connecting finance"
      return enhanced.map((run) => ({
        ...run,
        text: this.wordValidator.fixMergedText(run.text || '')
      }));
    };

    const html: string[] = [];

    for (const region of analysis.regions) {
      // Normalize region dimensions (round to 3 decimal places for precision)
      // Same normalization approach as preserve fidelity pipeline
      const regionLeft = this.normalizeCoord(region.rect.left);
      const regionTop = this.normalizeCoord(region.rect.top);
      const regionWidth = Math.max(0, this.normalizeCoord(region.rect.width));
      const regionHeight = Math.max(0, this.normalizeCoord(region.rect.height));

      // Region container (absolute positioned on page)
      html.push(
        `<div class="pdf-sem-region" style="position: absolute; left: ${regionLeft}px; top: ${regionTop}px; width: ${regionWidth}px; height: ${regionHeight}px;" data-x="${regionLeft}" data-top="${regionTop}" data-width="${regionWidth}" data-height="${regionHeight}" data-flow="${region.flowAllowed ? '1' : '0'}">`
      );

      const renderFlexLine = (mergedRuns: PDFTextContent[], lineHeight: number): void => {
        html.push(
          `<div class="pdf-sem-line" style="display: flex; flex-direction: row; align-items: flex-start; gap: 0; width: 100%; position: relative; height: ${lineHeight}px; line-height: ${lineHeight}px;">`
        );

        let cursorX = 0;

        for (let runIdx = 0; runIdx < mergedRuns.length; runIdx++) {
          const run = mergedRuns[runIdx]!;
          const prevRun = runIdx > 0 ? mergedRuns[runIdx - 1]! : null;
          const nextRun = runIdx < mergedRuns.length - 1 ? mergedRuns[runIdx + 1]! : null;
          const fontClass = this.getFontClass(run, fontMappings);

          const abs = this.layoutEngine.transformCoordinates(run.x, run.y, page.height, run.height);
          const xRel = this.normalizeCoord(abs.x - regionLeft);

          let runWidth = run.width && run.width > 0
            ? run.width
            : this.estimateTextWidth(run);

          const fontSize = run.fontSize || 12;
          const whitespace = this.detectWhitespacePadding(run, prevRun, nextRun, fontSize);
          runWidth = Math.max(0, this.normalizeCoord(runWidth + whitespace.widthAdjustment));

          const visualHeight = this.calculateVisualHeight(run, absLineHeightFactor);
          const runHeight = Math.max(1, this.normalizeCoord(visualHeight));

          const nextAbs = nextRun
            ? this.layoutEngine.transformCoordinates(nextRun.x, nextRun.y, page.height, nextRun.height)
            : null;
          const nextXRel = nextAbs ? this.normalizeCoord(nextAbs.x - regionLeft) : null;

          const widthBudget = nextXRel !== null
            ? Math.max(0, this.normalizeCoord(nextXRel - xRel - whitespace.paddingLeft - whitespace.paddingRight - minGapPx))
            : Math.max(0, this.normalizeCoord(regionWidth - xRel - whitespace.paddingLeft - whitespace.paddingRight));

          // Prefer Pdfium artifacts unless clearly wrong (e.g., 1px width when fontSize is 10px+)
          const textLen = (run.text || '').length;
          const minReasonableWidth = textLen > 1 ? fontSize * 0.1 * textLen : fontSize * 0.05;
          const pdfiumWidthIsValid = runWidth > 0 && runWidth >= minReasonableWidth;
          
          let desiredRunWidth = runWidth;
          
          // Only use font metrics when Pdfium width is missing or clearly corrupted
          if (!pdfiumWidthIsValid) {
            const resolver = getDefaultFontMetricsResolver();
            let measuredTextWidth = 0;
            try {
              if (run.fontInfo) {
                const match = resolver.resolveDetectedFont({
                  name: run.fontInfo.name,
                  family: run.fontFamily || run.fontInfo.name,
                  weight: run.fontWeight || 400,
                  style: run.fontStyle || 'normal',
                  embedded: run.fontInfo.embedded || false,
                  metrics: this.normalizePdfFontMetrics(run.fontInfo.metrics),
                  encoding: run.fontInfo.encoding
                });
                const textToMeasure = run.text || '';
                for (let i = 0; i < textToMeasure.length; i++) {
                  measuredTextWidth += resolver.estimateCharWidthPx(textToMeasure[i]!, match.record, fontSize);
                }
              }
            } catch {
              measuredTextWidth = 0;
            }
            
            if (measuredTextWidth > 0) {
              desiredRunWidth = this.normalizeCoord(measuredTextWidth);
            } else {
              desiredRunWidth = this.normalizeCoord(textLen * fontSize * 0.5);
            }
          } else {
            desiredRunWidth = this.normalizeCoord(runWidth);
          }
          
          const finalRunWidth = widthBudget > 0
            ? Math.min(desiredRunWidth, widthBudget)
            : desiredRunWidth;

          const delta = this.normalizeCoord(xRel - cursorX - whitespace.paddingLeft);

          const styleParts: string[] = [
            'position: relative',
            `width: ${finalRunWidth}px`,
            `height: ${runHeight}px`,
            'flex-shrink: 0',
            'display: inline-block',
            `line-height: ${runHeight}px`,
            'white-space: pre',
            'overflow: visible'
          ];

          if (Math.abs(delta) > minGapPx) {
            styleParts.push(`margin-left: ${delta}px`);
          }

          if (whitespace.paddingLeft > 0) {
            styleParts.push(`padding-left: ${whitespace.paddingLeft}px`);
          }
          if (whitespace.paddingRight > 0) {
            styleParts.push(`padding-right: ${whitespace.paddingRight}px`);
          }

          const textHtml = this.layoutEngine.generateInlineTextSpan(run, fontClass);
          html.push(
            `<span class="pdf-sem-text" style="${styleParts.join('; ')}">${textHtml}</span>`
          );

          cursorX = Math.max(cursorX, xRel + finalRunWidth + whitespace.paddingLeft + whitespace.paddingRight);
        }

        html.push('</div>');
      };

      const orderedLines = [...region.lines].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 0.5) return yDiff;
        return a.minX - b.minX;
      });

      const lineLooksLexicalParagraph = (line: (typeof orderedLines)[number]): boolean => {
        const raw = line.items.map((r) => r.text || '').join(' ');
        const lettersOnly = raw.replace(/[^A-Za-z]+/g, ' ');
        const tokens = lettersOnly
          .split(/\s+/)
          .map((t) => t.trim())
          .filter((t) => t.length >= 3 && t.length <= 24);
        if (tokens.length < 3) return false;
        let good = 0;
        for (const tok of tokens) {
          const res = this.wordValidator.validate(tok);
          if (res === 'complete' || res === 'prefix') good += 1;
        }
        const coverage = good / tokens.length;
        return coverage >= 0.45;
      };

      const lineLooksStructuredAnyStyle = (line: (typeof orderedLines)[number]): boolean => {
        if (lineLooksLexicalParagraph(line)) return false;
        const runs = line.items.filter((r) => (r.text || '').trim().length > 0);
        if (runs.length < 2) return false;
        const sorted = [...runs].sort((a, b) => a.x - b.x);
        for (let i = 0; i < sorted.length - 1; i++) {
          const cur = sorted[i]!;
          const next = sorted[i + 1]!;
          const curWidth = typeof cur.width === 'number' && Number.isFinite(cur.width) && cur.width > 0 ? cur.width : this.estimateTextWidth(cur);
          const gap = next.x - (cur.x + curWidth);
          const fontSize = (typeof cur.fontSize === 'number' && Number.isFinite(cur.fontSize) && cur.fontSize > 0) ? cur.fontSize : 12;
          const gapThreshold = Math.max(22, fontSize * 2.6, regionWidth * 0.08);
          if (gap >= gapThreshold) return true;
        }
        return false;
      };

      const rectIntersects = (a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }): boolean => {
        return a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
      };

      const borderLikeGraphicsCount = (() => {
        const regionRect = { left: regionLeft, top: regionTop, width: regionWidth, height: regionHeight };
        let count = 0;
        for (const g of page.content.graphics || []) {
          const b = this.getGraphicBounds(g);
          if (!b) continue;
          const w = b.maxX - b.minX;
          const h = b.maxY - b.minY;
          const gb = { left: b.minX, top: b.minY, width: Math.max(0, w), height: Math.max(0, h) };
          if (!rectIntersects(gb, regionRect)) continue;
          const thick = Math.max(Math.max(0, w), Math.max(0, h)) >= 12 && Math.min(Math.max(0, w), Math.max(0, h)) >= 1;
          if (thick) count += 1;
        }
        return count;
      })();

      const regionHasVerticalOverlaps = (() => {
        let prevBottom: number | null = null;
        for (const line of orderedLines) {
          const mergedRuns: PDFTextContent[] = getMergedRunsForLine(line);
          const lineBox = this.computeLineBoxFromRuns(mergedRuns, page.height, regionTop, absLineHeightFactor);
          const maxRunHeight = mergedRuns.reduce((acc, r) => {
            const h = this.normalizeCoord(Math.max(1, this.calculateVisualHeight(r, absLineHeightFactor)));
            return Math.max(acc, h);
          }, 1);
          const maxFontSize = mergedRuns.reduce((acc, r) => {
            const fs = typeof r.fontSize === 'number' && Number.isFinite(r.fontSize) ? r.fontSize : 12;
            return Math.max(acc, fs);
          }, 1);
          const top = Math.max(0, lineBox.lineTopRel);
          const height = Math.max(lineBox.lineHeight, maxRunHeight);
          const bottom = this.normalizeCoord(top + height);
          if (prevBottom !== null) {
            const overlap = prevBottom - top;
            const overlapThreshold = Math.max(3, maxFontSize * 0.35);
            if (overlap > overlapThreshold) return true;
          }
          prevBottom = bottom;
        }
        return false;
      })();

      const forceAbsoluteRegion =
        region.overlapsObstacle ||
        borderLikeGraphicsCount >= 2 ||
        orderedLines.some((l) => lineLooksStructuredAnyStyle(l)) ||
        regionHasVerticalOverlaps;

      if (forceAbsoluteRegion) {
        html.push('<div class="pdf-sem-lines" data-layout="absolute" style="position: relative; width: 100%; height: 100%;">');
        let prevAbsLineBottomRel: number | null = null;
        for (const line of orderedLines) {
          const mergedRuns: PDFTextContent[] = getMergedRunsForLine(line);
          const lineBox = this.computeLineBoxFromRuns(mergedRuns, page.height, regionTop, absLineHeightFactor);
          let lineTopRel = Math.max(0, lineBox.lineTopRel);
          const runGeoms = mergedRuns.map((run) => {
            const visualHeight = this.calculateVisualHeight(run, absLineHeightFactor);
            const runHeight = Math.max(1, this.normalizeCoord(visualHeight));
            const abs = this.layoutEngine.transformCoordinates(run.x, run.y, page.height, runHeight);
            return { run, runHeight, abs };
          });

          const maxRunHeight = runGeoms.reduce((acc, g) => Math.max(acc, g.runHeight), 1);
          const maxFontSize = mergedRuns.reduce((acc, r) => {
            const fs = typeof r.fontSize === 'number' && Number.isFinite(r.fontSize) ? r.fontSize : 12;
            return Math.max(acc, fs);
          }, 1);
          const lineHeight = Math.max(lineBox.lineHeight, maxRunHeight);

          if (prevAbsLineBottomRel !== null) {
            const minSeparation = Math.max(minGapPx, maxFontSize * 0.2, 1);
            if (lineTopRel < prevAbsLineBottomRel + minSeparation) {
              lineTopRel = this.normalizeCoord(prevAbsLineBottomRel + minSeparation);
            }
          }

          const baselineY = (() => {
            const ys = runGeoms.map((g) => g.abs.y).filter((y) => Number.isFinite(y));
            if (ys.length === 0) return regionTop + lineTopRel;
            ys.sort((a, b) => a - b);
            return ys[Math.floor(ys.length / 2)]!;
          })();

          html.push(
            `<div class="pdf-sem-line" style="position: absolute; left: 0; top: ${lineTopRel}px; width: ${regionWidth}px; height: ${lineHeight}px;">`
          );
          for (const geom of runGeoms) {
            const { run, runHeight, abs } = geom;
            const fontClass = this.getFontClass(run, fontMappings);
            const rel = {
              x: this.normalizeCoord(abs.x - regionLeft),
              y: this.normalizeCoord(baselineY - regionTop - lineTopRel)
            };
            const runForRender: PDFTextContent = { ...run, height: runHeight };
            html.push(this.layoutEngine.generateTextElement(runForRender, page.height, fontClass, { coordsOverride: rel }));
          }
          html.push('</div>');
          prevAbsLineBottomRel = this.normalizeCoord(lineTopRel + lineHeight);
        }
        html.push('</div>');
        html.push('</div>');
        continue;
      }

      html.push('<div class="pdf-sem-lines" data-layout="flex" style="display: flex; flex-direction: column; align-items: flex-start; gap: 0; width: 100%;">');

      let prevLineBottomRel: number | null = null;

      const regionLooksStructured = mergeSameStyleLines && orderedLines.some((line) => {
        const runs = line.items.filter((r) => (r.text || '').trim().length > 0);
        if (runs.length < 2) return false;
        const sorted = [...runs].sort((a, b) => a.x - b.x);
        const styleKeys = sorted.map((r) => [r.fontFamily, r.fontSize, r.fontWeight, r.fontStyle, r.color].join('|'));
        const uniformStyle = styleKeys.length > 0 && styleKeys.every((k) => k === styleKeys[0]);
        if (!uniformStyle) return false;

        for (let i = 0; i < sorted.length - 1; i++) {
          const cur = sorted[i]!;
          const next = sorted[i + 1]!;
          const curWidth = typeof cur.width === 'number' && Number.isFinite(cur.width) && cur.width > 0 ? cur.width : this.estimateTextWidth(cur);
          const gap = next.x - (cur.x + curWidth);
          const fontSize = (typeof cur.fontSize === 'number' && Number.isFinite(cur.fontSize) && cur.fontSize > 0) ? cur.fontSize : 12;
          const gapThreshold = Math.max(18, fontSize * 2.75, regionWidth * 0.06);
          if (gap >= gapThreshold) return true;
        }
        return false;
      });

      if (mergeSameStyleLines && region.flowAllowed && !regionLooksStructured) {
        type MergeGroup = {
          xRel: number;
          width: number;
          runHeight: number;
          reservedHeight: number;
          lineTopRel: number;
          segments: Array<
            | { kind: 'space' }
            | { kind: 'run'; run: PDFTextContent; fontClass: string; text: string }
          >;
        };

        const ensureJoined = (
          target: MergeGroup['segments'],
          nextRun: PDFTextContent,
          nextFontClass: string,
          nextTextRaw: string
        ): void => {
          const nextText = (nextTextRaw || '').replace(/^\s+/u, '');
          if (!nextText.trim()) return;

          const lastIdx = (() => {
            for (let i = target.length - 1; i >= 0; i--) {
              if (target[i]?.kind === 'run') return i;
            }
            return -1;
          })();

          if (lastIdx < 0) {
            target.push({ kind: 'run', run: nextRun, fontClass: nextFontClass, text: nextText.replace(/^\s+/u, '') });
            return;
          }

          const last = target[lastIdx] as Extract<MergeGroup['segments'][number], { kind: 'run' }>;
          const prevTrim = (last.text || '').replace(/\s+$/u, '');
          const nextTrim = nextText.replace(/^\s+/u, '');
          if (!prevTrim) {
            last.text = prevTrim;
            target.push({ kind: 'run', run: nextRun, fontClass: nextFontClass, text: nextTrim });
            return;
          }
          if (!nextTrim) {
            last.text = prevTrim;
            return;
          }

          const prevEnd = prevTrim.slice(-1);
          const nextStart = nextTrim.slice(0, 1);
          let glue = ' ';

          const lastRunText = (last.run?.text || '') as string;
          const explicitSpace = /\s$/u.test(lastRunText) || /^\s/u.test(nextTextRaw || '');
          const lastRunWidth =
            typeof last.run.width === 'number' && Number.isFinite(last.run.width) && last.run.width > 0
              ? last.run.width
              : this.estimateTextWidth(last.run);
          const gap = nextRun.x - (last.run.x + lastRunWidth);
          const lastFontSize = (typeof last.run.fontSize === 'number' && Number.isFinite(last.run.fontSize) && last.run.fontSize > 0)
            ? last.run.fontSize
            : 12;
          const nextFontSize = (typeof nextRun.fontSize === 'number' && Number.isFinite(nextRun.fontSize) && nextRun.fontSize > 0)
            ? nextRun.fontSize
            : lastFontSize;
          const avgFontSize = (lastFontSize + nextFontSize) / 2;
          const tightGap = Math.max(0.0, avgFontSize * 0.12);
          const spaceGap = Math.max(0.6, avgFontSize * 0.28);

          if (prevEnd === '-') {
            last.text = prevTrim.slice(0, -1);
            glue = '';
          } else {
            last.text = prevTrim;
            if (/[([{"'\u2018\u201C]/u.test(prevEnd)) {
              glue = '';
            } else if (/[)\]}"'\u2019\u201D,.;:!?]/u.test(nextStart)) {
              glue = '';
            }
          }

          if (glue) {
            if (Number.isFinite(gap) && gap <= tightGap) {
              glue = '';
            } else if (explicitSpace) {
              glue = ' ';
            } else if (Number.isFinite(gap) && gap >= spaceGap) {
              glue = ' ';
            } else {
              const prevIsWord = /[\p{L}\p{N}]$/u.test(prevTrim);
              const nextIsWord = /^[\p{L}\p{N}]/u.test(nextTrim);
              glue = prevIsWord && nextIsWord ? ' ' : '';
            }
          }

          if (glue) target.push({ kind: 'space' });
          target.push({ kind: 'run', run: nextRun, fontClass: nextFontClass, text: nextTrim });
        };

        const buildSegmentsForRuns = (runs: PDFTextContent[]): MergeGroup['segments'] => {
          const out: MergeGroup['segments'] = [];
          const sorted = [...runs].sort((a, b) => a.x - b.x);
          for (const r of sorted) {
            const t = r.text || '';
            if (!t.trim()) continue;
            const fc = this.getFontClass(r, fontMappings);
            ensureJoined(out, r, fc, t);
          }
          return out;
        };

        const flush = (g: MergeGroup | null): void => {
          if (!g) return;
          const styleParts: string[] = [
            'display: block',
            `margin-left: ${g.xRel}px`,
            `width: ${g.width}px`,
            `max-width: ${g.width}px`,
            `min-height: ${g.reservedHeight}px`,
            `line-height: ${g.runHeight}px`,
            'white-space: pre',
            'overflow-wrap: normal',
            'word-break: normal',
            'hyphens: none',
            'overflow: visible'
          ];
          const inner = g.segments.map((s) => {
            if (s.kind === 'space') return ' ';
            const textRun: PDFTextContent = { ...s.run, text: s.text };
            return this.layoutEngine.generateInlineTextSpan(textRun, s.fontClass);
          }).join('');
          html.push(`<div class="pdf-sem-paragraph" style="${styleParts.join('; ')}">${inner}</div>`);
        };

        let group: MergeGroup | null = null;

        const lineLooksStructured = (line: (typeof orderedLines)[number]): boolean => {
          const runs = line.items.filter((r) => (r.text || '').trim().length > 0);
          if (runs.length < 2) return false;
          const sorted = [...runs].sort((a, b) => a.x - b.x);
          for (let i = 0; i < sorted.length - 1; i++) {
            const cur = sorted[i]!;
            const next = sorted[i + 1]!;
            const curWidth = typeof cur.width === 'number' && Number.isFinite(cur.width) && cur.width > 0 ? cur.width : this.estimateTextWidth(cur);
            const gap = next.x - (cur.x + curWidth);
            const fontSize = (typeof cur.fontSize === 'number' && Number.isFinite(cur.fontSize) && cur.fontSize > 0) ? cur.fontSize : 12;
            const gapThreshold = Math.max(18, fontSize * 2.75, regionWidth * 0.06);
            if (gap >= gapThreshold) return true;
          }
          return false;
        };

        for (let lineIdx = 0; lineIdx < orderedLines.length; lineIdx++) {
          const line = orderedLines[lineIdx]!;
          const mergedRuns: PDFTextContent[] = getMergedRunsForLine(line);

          const lineBox = this.computeLineBoxFromRuns(mergedRuns, page.height, regionTop, absLineHeightFactor);
          const lineTopRel = lineBox.lineTopRel;
          const maxRunHeight = mergedRuns.reduce((acc, r) => {
            const h = this.normalizeCoord(Math.max(1, this.calculateVisualHeight(r, absLineHeightFactor)));
            return Math.max(acc, h);
          }, 1);
          const lineHeight = Math.max(lineBox.lineHeight, maxRunHeight);
          const lineBottomRel = lineBox.lineBottomRel;

          if (prevLineBottomRel === null) {
            const vGap = this.normalizeCoord(lineTopRel);
            if (vGap > minGapPx) {
              html.push(`<div class="pdf-sem-vgap" style="height: ${vGap}px; flex-shrink: 0; width: 100%;"></div>`);
            }
          } else {
            const vGap = this.normalizeCoord(lineTopRel - prevLineBottomRel);
            if (vGap > minGapPx) {
              flush(group);
              group = null;
              html.push(`<div class="pdf-sem-vgap" style="height: ${vGap}px; flex-shrink: 0; width: 100%;"></div>`);
            }
          }

          if (mergedRuns.length === 0 || !mergedRuns.some((r) => (r.text || '').trim().length > 0) || lineLooksStructured(line)) {
            flush(group);
            group = null;
            if (mergedRuns.length > 0) {
              renderFlexLine(mergedRuns, lineHeight);
            }
            prevLineBottomRel = lineBottomRel;
            continue;
          }

          const representative = [...mergedRuns].sort((a, b) => a.x - b.x)[0]!;
          const abs = this.layoutEngine.transformCoordinates(representative.x, representative.y, page.height, representative.height);
          const xRel = this.normalizeCoord(abs.x - regionLeft);
          const runHeight = Math.max(1, this.normalizeCoord(this.calculateVisualHeight(representative, absLineHeightFactor)));
          const width = Math.max(0, this.normalizeCoord(regionWidth - xRel));

          const lineSegments = buildSegmentsForRuns(mergedRuns);
          const hasTextSegments = lineSegments.some((s) => s.kind === 'run' && (s.text || '').trim().length > 0);
          if (!hasTextSegments) {
            flush(group);
            group = null;
            renderFlexLine(mergedRuns, lineHeight);
            prevLineBottomRel = lineBottomRel;
            continue;
          }

          const canMergeWithPrev = group !== null && Math.abs(group.xRel - xRel) <= 1.5;

          if (!canMergeWithPrev) {
            flush(group);
            group = {
              xRel,
              width,
              runHeight,
              reservedHeight: lineHeight,
              lineTopRel,
              segments: lineSegments
            };
          } else {
            group!.runHeight = Math.max(group!.runHeight, runHeight);
            group!.reservedHeight = this.normalizeCoord(Math.max(group!.reservedHeight, lineBottomRel - group!.lineTopRel));
            for (const seg of lineSegments) {
              if (seg.kind === 'space') {
                group!.segments.push(seg);
              } else {
                ensureJoined(group!.segments, seg.run, seg.fontClass, seg.text);
              }
            }
          }

          prevLineBottomRel = lineBottomRel;
        }

        flush(group);

        html.push('</div>'); // Close lines container
        html.push('</div>'); // Close region container
        continue;
      }

      for (let lineIdx = 0; lineIdx < orderedLines.length; lineIdx++) {
        const line = orderedLines[lineIdx]!;
        // Use merged runs from analysis (already normalized and measured by ImprovedTextMerger)
        // mergedRuns are TextRun[] which have the same structure as PDFTextContent
        const mergedRuns: PDFTextContent[] = getMergedRunsForLine(line);

        const lineBox = this.computeLineBoxFromRuns(mergedRuns, page.height, regionTop, absLineHeightFactor);
        const lineTopRel = lineBox.lineTopRel;
        const maxRunHeight = mergedRuns.reduce((acc, r) => {
          const h = this.normalizeCoord(Math.max(1, this.calculateVisualHeight(r, absLineHeightFactor)));
          return Math.max(acc, h);
        }, 1);
        const lineHeight = Math.max(lineBox.lineHeight, maxRunHeight);
        const lineBottomRel = lineBox.lineBottomRel;

        // Calculate vertical gap before this line (region-relative)
        if (prevLineBottomRel === null) {
          const vGap = this.normalizeCoord(lineTopRel);
          if (vGap > minGapPx) {
            html.push(`<div class="pdf-sem-vgap" style="height: ${vGap}px; flex-shrink: 0; width: 100%;"></div>`);
          }
        } else {
          const vGap = this.normalizeCoord(lineTopRel - prevLineBottomRel);
          if (vGap > minGapPx) {
            html.push(`<div class="pdf-sem-vgap" style="height: ${vGap}px; flex-shrink: 0; width: 100%;"></div>`);
          }
        }

        // Line container (flexbox row)
        html.push(
          `<div class="pdf-sem-line" style="display: flex; flex-direction: row; align-items: flex-start; gap: 0; width: 100%; position: relative; height: ${lineHeight}px; line-height: ${lineHeight}px;">`
        );

        let cursorX = 0;

        for (let runIdx = 0; runIdx < mergedRuns.length; runIdx++) {
          const run = mergedRuns[runIdx]!;
          const prevRun = runIdx > 0 ? mergedRuns[runIdx - 1]! : null;
          const nextRun = runIdx < mergedRuns.length - 1 ? mergedRuns[runIdx + 1]! : null;
          const fontClass = this.getFontClass(run, fontMappings);
          
          // Transform PDF coordinates to HTML coordinates (same as preserve fidelity)
          const abs = this.layoutEngine.transformCoordinates(run.x, run.y, page.height, run.height);
          
          // Calculate relative position within region (normalized to 3 decimal places)
          const xRel = this.normalizeCoord(abs.x - regionLeft);

          // Use actual PDF measurements (normalized to 3 decimal places)
          // Width: Prioritize actual PDF width from merged run (most accurate)
          // ImprovedTextMerger already calculates accurate widths from PDF coordinates
          // Only estimate if width is missing or invalid
          let runWidth = run.width && run.width > 0 
            ? run.width 
            : this.estimateTextWidth(run);
          
          // Detect nearby whitespace and calculate padding for better visual spacing
          const fontSize = run.fontSize || 12;
          const whitespace = this.detectWhitespacePadding(run, prevRun, nextRun, fontSize);
          
          // Adjust width to include detected whitespace padding
          runWidth = Math.max(0, this.normalizeCoord(runWidth + whitespace.widthAdjustment));
          
          // Height: Use actual PDF height or calculated from font size (same as preserve fidelity)
          const visualHeight = this.calculateVisualHeight(run, absLineHeightFactor);
          const runHeight = Math.max(1, this.normalizeCoord(visualHeight));

          const nextAbs = nextRun
            ? this.layoutEngine.transformCoordinates(nextRun.x, nextRun.y, page.height, nextRun.height)
            : null;
          const nextXRel = nextAbs ? this.normalizeCoord(nextAbs.x - regionLeft) : null;

          // Build style with padding if detected
          // Compute width budget (avoid overlaps) and allow expansion when safe
          const widthBudget = nextXRel !== null
            ? Math.max(0, this.normalizeCoord(nextXRel - xRel - whitespace.paddingLeft - whitespace.paddingRight - minGapPx))
            : Math.max(0, this.normalizeCoord(regionWidth - xRel - whitespace.paddingLeft - whitespace.paddingRight));

          // Prefer Pdfium artifacts unless clearly wrong (e.g., 1px width when fontSize is 10px+)
          const textLen = (run.text || '').length;
          const minReasonableWidth = textLen > 1 ? fontSize * 0.1 * textLen : fontSize * 0.05;
          const pdfiumWidthIsValid = runWidth > 0 && runWidth >= minReasonableWidth;
          
          let desiredRunWidth = runWidth;
          
          // Only use font metrics when Pdfium width is missing or clearly corrupted
          if (!pdfiumWidthIsValid) {
            const resolver = getDefaultFontMetricsResolver();
            let measuredTextWidth = 0;
            try {
              if (run.fontInfo) {
                const match = resolver.resolveDetectedFont({
                  name: run.fontInfo.name,
                  family: run.fontFamily || run.fontInfo.name,
                  weight: run.fontWeight || 400,
                  style: run.fontStyle || 'normal',
                  embedded: run.fontInfo.embedded || false,
                  metrics: this.normalizePdfFontMetrics(run.fontInfo.metrics),
                  encoding: run.fontInfo.encoding
                });
                const textToMeasure = run.text || '';
                for (let i = 0; i < textToMeasure.length; i++) {
                  measuredTextWidth += resolver.estimateCharWidthPx(textToMeasure[i]!, match.record, fontSize);
                }
              }
            } catch {
              measuredTextWidth = 0;
            }
            
            if (measuredTextWidth > 0) {
              desiredRunWidth = this.normalizeCoord(measuredTextWidth);
            } else {
              desiredRunWidth = this.normalizeCoord(textLen * fontSize * 0.5);
            }
          } else {
            desiredRunWidth = this.normalizeCoord(runWidth);
          }
          
          const finalRunWidth = widthBudget > 0
            ? Math.min(desiredRunWidth, widthBudget)
            : desiredRunWidth;

          // Compute relative delta to requested x position; allow negative deltas via margin-left
          const delta = this.normalizeCoord(xRel - cursorX - whitespace.paddingLeft);

          const styleParts: string[] = [
            'position: relative',
            `width: ${finalRunWidth}px`,
            `height: ${runHeight}px`,
            'flex-shrink: 0',
            'display: inline-block',
            `line-height: ${runHeight}px`,
            'white-space: pre',
            'overflow: visible'
          ];

          if (Math.abs(delta) > minGapPx) {
            styleParts.push(`margin-left: ${delta}px`);
          }
          
          if (whitespace.paddingLeft > 0) {
            styleParts.push(`padding-left: ${whitespace.paddingLeft}px`);
          }
          if (whitespace.paddingRight > 0) {
            styleParts.push(`padding-right: ${whitespace.paddingRight}px`);
          }

          // Generate text element with relative positioning and exact dimensions
          const textHtml = this.layoutEngine.generateInlineTextSpan(run, fontClass);
          html.push(
            `<span class="pdf-sem-text" style="${styleParts.join('; ')}">${textHtml}</span>`
          );

          // Update cursor using actual run end position (xRel + runWidth + padding)
          // This ensures accurate positioning for next run
          cursorX = Math.max(cursorX, xRel + finalRunWidth + whitespace.paddingLeft + whitespace.paddingRight);
        }

        html.push('</div>'); // Close line container

        prevLineBottomRel = lineBottomRel;
      }

      html.push('</div>'); // Close lines container
      html.push('</div>'); // Close region container
    }

    return html.join('\n');
  }

  private generateAbsoluteSemanticText(page: PDFPage, fontMappings: FontMapping[]): string {
    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const absLineHeightFactor = this.options.layoutTuning?.absLineHeightFactor ?? 1.25;

    const html: string[] = [];

    for (const region of analysis.regions) {
      const width = Math.max(0, region.rect.width);
      const height = Math.max(0, region.rect.height);

      html.push(
        `<div class="pdf-sem-region" style="position: absolute; left: ${region.rect.left}px; top: ${region.rect.top}px; width: ${width}px; height: ${height}px;" data-x="${region.rect.left}" data-top="${region.rect.top}" data-width="${width}" data-height="${height}" data-flow="${region.flowAllowed ? '1' : '0'}">`
      );

      const orderedLines = [...region.lines].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 0.5) return yDiff;
        return a.minX - b.minX;
      });

      for (const line of orderedLines) {
        const mergedRuns = this.mergeTextRuns(line.items).map((run) => ({
          ...run,
          text: this.wordValidator.fixMergedText(run.text || '')
        }));
        const lineTop = Math.max(0, Math.round((line.rect.top - region.rect.top) * 1000) / 1000);

        const avgFontSize =
          typeof line.avgFontSize === 'number' && Number.isFinite(line.avgFontSize) && line.avgFontSize > 0
            ? line.avgFontSize
            : (line.items.length > 0
              ? (line.items.reduce((sum, t) => sum + (Number.isFinite(t.fontSize) ? t.fontSize : 0), 0) / Math.max(1, line.items.length))
              : 0);

        const lineHeight = Math.max(
          1,
          Math.round(Math.max(line.rect.height, avgFontSize * absLineHeightFactor) * 1000) / 1000
        );

        html.push(
          `<div class="pdf-sem-line" style="position: absolute; left: 0; top: ${lineTop}px; width: ${width}px; height: ${lineHeight}px;">`
        );

        for (const run of mergedRuns) {
          const fontClass = this.getFontClass(run, fontMappings);
          const abs = this.layoutEngine.transformCoordinates(run.x, run.y, page.height, run.height);
          const rel = {
            x: abs.x - region.rect.left,
            y: abs.y - region.rect.top - lineTop
          };
          html.push(this.layoutEngine.generateTextElement(run, page.height, fontClass, { coordsOverride: rel }));
        }

        html.push('</div>');
      }

      html.push('</div>');
    }

    return html.join('\n');
  }

  private generateSvgTextLayer(page: PDFPage, fontMappings: FontMapping[]): string {
    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const svgOut: string[] = [];
    const htmlOut: string[] = [];
    
    svgOut.push(
      `<svg class="pdf-text-layer" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}" style="position: absolute; left: 0; top: 0; width: ${page.width}px; height: ${page.height}px; overflow: visible; pointer-events: none;">`
    );

    for (const region of analysis.regions) {
      for (const line of region.lines) {
        const mergedRuns = this.mergeTextRuns(line.items);
        for (const run of mergedRuns) {
          // Apply post-processing to fix merged words like "connectingfinance"
          const fixedRun = {
            ...run,
            text: this.wordValidator.fixMergedText(run.text || '')
          };
          
          // Check if this run should use SVG text
          const textContent = this.layoutEngine.getProcessedTextContent(fixedRun);
          if (this.layoutEngine.shouldUseSvgText(textContent)) {
            const fontClass = this.getFontClass(fixedRun, fontMappings);
            svgOut.push(this.layoutEngine.generateSvgTextElement(fixedRun, page.height, fontClass));
          } else {
            // Fall back to HTML text for problematic runs
            htmlOut.push(this.layoutEngine.generateTextElement(fixedRun, page.height, this.getFontClass(fixedRun, fontMappings)));
          }
        }
      }
    }

    svgOut.push('</svg>');
    
    // Return SVG with HTML fallbacks if needed
    if (htmlOut.length > 0) {
      return svgOut.join('\n') + '\n<div class="pdf-text-fallback" style="position: absolute; left: 0; top: 0; width: 100%; height: 100%; pointer-events: none;">\n' + htmlOut.join('\n') + '\n</div>';
    }
    
    return svgOut.join('\n');
  }

  private generatePageHTML(
    page: PDFPage,
    fontMappings: FontMapping[]
  ): string {
    const parts: string[] = [];

    if (this.options.preserveLayout && this.options.textLayout === 'semantic') {
      this.applyUnderlineGraphicsToText(page);
    }

    const pageClass = this.options.preserveLayout
      ? `pdf-page pdf-page-${page.pageNumber}`
      : 'pdf-page';

    const pageStyle = this.options.preserveLayout
      ? `style="position: relative; width: ${page.width}px; height: ${page.height}px; margin: 0 auto; background: white;"`
      : 'style="position: relative; width: 100%; max-width: 100%; background: white;"';

    parts.push(`<div class="${pageClass}" ${pageStyle}>`);

    // Generate graphics (SVG/vector elements) first so text/images can render on top
    if (page.content.graphics.length > 0) {
      parts.push(this.generateGraphicsSVG(page.content.graphics, page.width, page.height));
    }

    // Generate images (render above vector backgrounds)
    for (const image of page.content.images) {
      parts.push(this.layoutEngine.generateImageElement(image, page.height, this.options.baseUrl));
    }

    // Try other text rendering methods first, SVG is now a last resort
    if (this.options.textLayout === 'semantic' && this.options.preserveLayout) {
      parts.push(this.generatePositionedSemanticText(page, fontMappings));
    } else if (this.options.textLayout === 'flow' && this.options.preserveLayout) {
      parts.push(this.generateOutlineFlowText(page, fontMappings));
    } else if (!this.options.preserveLayout && this.options.textLayout === 'flow') {
      const semantic = this.semanticHtmlGenerator.generateSemanticHTML(page, this.regionLayoutAnalyzer, this.options.semanticLayout, {
        getFontClass: (fontFamily: string) => this.getFontClass(fontFamily, fontMappings),
        renderInlineSpan: (text: PDFTextContent, fontClass: string) => this.layoutEngine.generateInlineTextSpan(text, fontClass)
      });
      parts.push(semantic);
    } else if (this.options.preserveLayout && this.options.textLayout === 'smart') {
      parts.push(this.generateSmartText(page, fontMappings));
    } else if (this.options.preserveLayout && this.options.textRenderMode === 'svg') {
      // Only use SVG text if explicitly requested and all other methods are not available
      parts.push(this.generateSvgTextLayer(page, fontMappings));
    } else {
      if (this.options.preserveLayout) {
        const analysis = this.regionLayoutAnalyzer.analyze(page);
        for (const region of analysis.regions) {
          for (const line of region.lines) {
            const mergedRuns = this.mergeTextRuns(line.items).map((run) => ({
              ...run,
              text: this.wordValidator.fixMergedText(run.text || '')
            }));
            for (const run of mergedRuns) {
              const fontClass = this.getFontClass(run, fontMappings);
              parts.push(this.layoutEngine.generateTextElement(run, page.height, fontClass));
            }
          }
        }
      } else {
        for (const text of page.content.text) {
          const fixedText = {
            ...text,
            text: this.wordValidator.fixMergedText(text.text || '')
          };
          const fontClass = this.getFontClass(fixedText, fontMappings);
          parts.push(this.layoutEngine.generateTextElement(fixedText, page.height, fontClass));
        }
      }
    }

    // Generate forms (if any)
    if (page.content.forms.length > 0) {
      for (const form of page.content.forms) {
        parts.push(this.generateFormElement(form, page.height));
      }
    }

    // Generate annotations (if any)
    if (page.content.annotations.length > 0) {
      for (const annotation of page.content.annotations) {
        parts.push(this.generateAnnotationElement(annotation, page.height));
      }
    }

    parts.push('</div>');

    return parts.join('\n');
  }

  private generateOutlineFlowText(page: PDFPage, fontMappings: FontMapping[]): string {
    const items = page.content.text;
    if (!items || items.length === 0) return '';

    const nonEmpty = items.filter((t) => t.text && t.text.trim().length > 0);
    if (nonEmpty.length === 0) return '';

    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const passes = this.options.textLayoutPasses ?? 1;
    const html: string[] = [];

    const headingThreshold =
      typeof this.options.semanticLayout?.headingThreshold === 'number'
        ? this.options.semanticLayout.headingThreshold
        : 1.2;
    const maxHeadingLength =
      typeof this.options.semanticLayout?.maxHeadingLength === 'number'
        ? this.options.semanticLayout.maxHeadingLength
        : 100;
    const medianFontSize = analysis.medianFontSize || 12;

    const getListMarkerInfo = (text: string): { listType: 'ul' | 'ol' } | null => {
      const trimmed = text.trimStart();
      if (!trimmed) return null;
      for (const entry of HTMLGenerator.OUTLINE_LIST_MARKERS) {
        if (entry.pattern.test(trimmed)) return { listType: entry.listType };
      }
      return null;
    };

    const stripListMarkerFromTokens = (tokens: LineToken[]): LineToken[] => {
      if (!tokens || tokens.length === 0) return tokens;
      const raw = tokens
        .map((t) => (t.type === 'space' ? ' ' : t.text))
        .join('');
      const leadingWs = raw.length - raw.trimStart().length;
      const trimmed = raw.trimStart();
      if (!trimmed) return tokens;

      let markerLen = 0;
      for (const entry of HTMLGenerator.OUTLINE_LIST_MARKERS) {
        const m = trimmed.match(entry.pattern);
        if (m && m[0]) {
          markerLen = m[0].length;
          break;
        }
      }
      if (markerLen <= 0) return tokens;

      let toRemove = leadingWs + markerLen;
      const out: LineToken[] = [];

      for (const t of tokens) {
        if (toRemove <= 0) {
          out.push(t);
          continue;
        }

        if (t.type === 'space') {
          toRemove -= 1;
          continue;
        }

        const text = t.text || '';
        if (text.length <= toRemove) {
          toRemove -= text.length;
          continue;
        }

        out.push({ ...t, text: text.slice(toRemove) });
        toRemove = 0;
      }

      return out;
    };

    const shouldBeHeading = (p: (typeof analysis.regions)[number]['paragraphs'][number]): { level: number } | null => {
      const txt = p.lines
        .map((l) => (l.text || '').trim())
        .filter((t) => t.length > 0)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!txt) return null;
      if (txt.length > maxHeadingLength) return null;
      if (p.lines.length !== 1) return null;

      const fs = p.dominant?.fontSize || 12;
      const ratio = fs / medianFontSize;
      if (ratio < headingThreshold) return null;

      const isBold = (p.dominant?.fontWeight || 400) > 450;
      const isAllCaps = txt === txt.toUpperCase() && /[A-Z]/.test(txt);
      if (!isBold && !isAllCaps) return null;

      const level = ratio >= 2.0 ? 1 : ratio >= 1.8 ? 2 : ratio >= 1.5 ? 3 : ratio >= 1.3 ? 4 : ratio >= 1.2 ? 5 : 6;
      return { level };
    };

    for (const region of analysis.regions) {
      const width = Math.max(0, region.rect.width);
      const height = Math.max(0, region.rect.height);

      html.push(
        `<div class="pdf-text-region" style="position: absolute; left: ${region.rect.left}px; top: ${region.rect.top}px; width: ${width}px; min-height: ${height}px;" data-x="${region.rect.left}" data-top="${region.rect.top}" data-width="${width}" data-height="${height}" data-flow="${region.flowAllowed ? '1' : '0'}">`
      );

      if (region.flowAllowed && region.paragraphs.length > 0) {
        let openListType: 'ul' | 'ol' | null = null;

        const closeList = (): void => {
          if (!openListType) return;
          html.push(`</${openListType}>`);
          openListType = null;
        };

        for (const paragraph of region.paragraphs) {
          const heading = shouldBeHeading(paragraph);
          if (heading) {
            closeList();
          }

          const dominant = paragraph.dominant;
          const fontClass = this.getFontClass(dominant, fontMappings);
          const lineHeight = Math.max(1, Math.round(paragraph.lineHeight * 1000) / 1000);
          const flowStyle: Record<string, string> = {
            position: 'relative',
            'white-space': 'pre-wrap',
            'line-height': `${lineHeight}px`,
            ...(passes >= 2 ? {} : { 'font-size': `${dominant.fontSize}px`, color: dominant.color })
          };
          if (passes < 2) {
            if (dominant.fontWeight && dominant.fontWeight !== 400) flowStyle['font-weight'] = String(dominant.fontWeight);
            if (dominant.fontStyle && dominant.fontStyle !== 'normal') flowStyle['font-style'] = dominant.fontStyle;
          }

          const flowClass = this.getFlowStyleClass(flowStyle);

          const mt = Math.max(0, Math.round(paragraph.gapBefore * 1000) / 1000);
          const indents = paragraph.lines.map((l) => l.indent);
          const minIndent = indents.length > 0 ? Math.max(0, Math.round(Math.min(...indents) * 1000) / 1000) : 0;
          const firstIndent = indents.length > 0 ? Math.max(0, Math.round(indents[0] * 1000) / 1000) : 0;
          const textIndent = Math.round((firstIndent - minIndent) * 1000) / 1000;

          const inlineParts: string[] = [];
          if (mt > 0) inlineParts.push(`margin-top: ${mt}px`);
          if (minIndent > 0) inlineParts.push(`padding-left: ${minIndent}px`);
          if (Math.abs(textIndent) > 0.01) inlineParts.push(`text-indent: ${textIndent}px`);
          const inlineStyle = inlineParts.length > 0 ? ` style="${inlineParts.join('; ')}"` : '';

          let paragraphBody: string;

          const listMarkerText = paragraph.lines.length > 0 ? (paragraph.lines[0]?.text || '') : '';
          const listInfo = getListMarkerInfo(listMarkerText);
          if (listInfo) {
            if (openListType && openListType !== listInfo.listType) {
              closeList();
            }
            if (!openListType) {
              openListType = listInfo.listType;
              html.push(`<${openListType}>`);
            }
          } else {
            closeList();
          }

          if (passes >= 2) {
            const parts: string[] = [];

            for (let i = 0; i < paragraph.lines.length; i++) {
              const lineEntry = paragraph.lines[i];

              if (i > 0 && !lineEntry.joinWithPrev) {
                parts.push('<br/>');
              }

              const sourceLine = lineEntry.sourceLine;
              if (!sourceLine) {
                const fallback = (lineEntry.text || '').trim();
                if (fallback.length > 0) parts.push(this.escapeHtml(fallback));
                continue;
              }

              let tokens = this.regionLayoutAnalyzer.reconstructLineTokens(sourceLine.items) as LineToken[];
              const nextEntry = paragraph.lines[i + 1];
              if (nextEntry?.joinWithPrev === 'hyphenation') {
                tokens = this.stripTrailingSoftHyphen(tokens);
              }

              if (listInfo && i === 0) {
                tokens = stripListMarkerFromTokens(tokens);
              }

              parts.push(this.renderTokens(tokens, fontMappings));
            }

            paragraphBody = parts.join('');
          } else {
            const mergedText = paragraph.lines
              .map((l) => (l.text || '').trim())
              .filter((t) => t.length > 0)
              .join('\n');
            const stripped = listInfo
              ? mergedText.replace(/^\s+/, '').replace(HTMLGenerator.OUTLINE_LIST_MARKERS.find((x) => x.listType === listInfo.listType)?.pattern ?? /^$/, '')
              : mergedText;
            paragraphBody = this.escapeHtml(stripped).replace(/\n/g, '<br/>');
          }

          if (heading) {
            html.push(`<h${heading.level} class="${fontClass} ${flowClass}"${inlineStyle}>${paragraphBody}</h${heading.level}>`);
          } else if (listInfo) {
            html.push(`<li class="${fontClass} ${flowClass}"${inlineStyle}>${paragraphBody}</li>`);
          } else {
            html.push(`<p class="${fontClass} ${flowClass}"${inlineStyle}>${paragraphBody}</p>`);
          }
        }

        if (openListType) {
          html.push(`</${openListType}>`);
        }

        html.push('</div>');
        continue;
      }

      const orderedLines = [...region.lines].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 0.5) return yDiff;
        return a.minX - b.minX;
      });

      let prevBottom: number | null = null;

      html.push('<div style="position: relative; white-space: normal;">');

      for (const line of orderedLines) {
        const text = this.regionLayoutAnalyzer.reconstructLineText(line.items);
        if (!text || text.trim().length === 0) continue;

        const mt =
          typeof prevBottom === 'number'
            ? Math.max(0, Math.round((line.rect.top - prevBottom) * 1000) / 1000)
            : 0;
        prevBottom = line.rect.top + line.rect.height;

        const tokens = this.regionLayoutAnalyzer.reconstructLineTokens(line.items) as LineToken[];
        const body = passes >= 2 ? this.renderTokens(tokens, fontMappings) : this.escapeHtml(text);

        const styleParts: string[] = ['display: block'];
        if (mt > 0.25) styleParts.push(`margin-top: ${mt}px`);
        html.push(`<div style="${styleParts.join('; ')}">${body}</div>`);
      }

      html.push('</div>');
      html.push('</div>');
    }

    return html.join('\n');
  }

  private generateSmartText(page: PDFPage, fontMappings: FontMapping[]): string {
    const items = page.content.text;
    if (!items || items.length === 0) return '';

    const nonEmpty = items.filter((t) => t.text && t.text.trim().length > 0);
    if (nonEmpty.length === 0) return '';

    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const passes = this.options.textLayoutPasses ?? 1;

    const html: string[] = [];

    for (const region of analysis.regions) {
      const width = Math.max(0, region.rect.width);
      const height = Math.max(0, region.rect.height);

      const useFlow = !this.options.preserveLayout && region.flowAllowed;
      if (!useFlow) {
        html.push(
          `<div class="pdf-abs-region" style="position: absolute; left: ${region.rect.left}px; top: ${region.rect.top}px; width: ${width}px; height: ${height}px;" data-x="${region.rect.left}" data-top="${region.rect.top}" data-width="${width}" data-height="${height}">`
        );

        const orderedLines = [...region.lines].sort((a, b) => {
          const yDiff = a.rect.top - b.rect.top;
          if (Math.abs(yDiff) > 0.5) return yDiff;
          return a.minX - b.minX;
        });

        for (let lineIndex = 0; lineIndex < orderedLines.length; lineIndex++) {
          const line = orderedLines[lineIndex];
          const lineTop = Math.max(0, Math.round((line.rect.top - region.rect.top) * 1000) / 1000);

          const avgFontSize =
            typeof line.avgFontSize === 'number' && Number.isFinite(line.avgFontSize) && line.avgFontSize > 0
              ? line.avgFontSize
              : (line.items.length > 0
                ? (line.items.reduce((sum, t) => sum + (Number.isFinite(t.fontSize) ? t.fontSize : 0), 0) / Math.max(1, line.items.length))
                : 0);

          const lineHeight = Math.max(
            1,
            Math.round(Math.max(line.rect.height, avgFontSize * (this.options.layoutTuning?.absLineHeightFactor ?? 1.25)) * 1000) / 1000
          );

          const nextLine = lineIndex < orderedLines.length - 1 ? orderedLines[lineIndex + 1] : null;
          const nextLineTop = nextLine
            ? Math.max(0, Math.round((nextLine.rect.top - region.rect.top) * 1000) / 1000)
            : null;
          const maxHeightBeforeNext = nextLineTop !== null ? Math.max(0, nextLineTop - lineTop) : null;
          const effectiveLineHeight =
            maxHeightBeforeNext !== null && maxHeightBeforeNext > 0.5
              ? Math.max(1, Math.min(lineHeight, maxHeightBeforeNext))
              : lineHeight;
          const mergedRuns = this.mergeTextRuns(line.items).map((run) => ({
            ...run,
            text: this.wordValidator.fixMergedText(run.text || '')
          }));

          const canRelativeRebuild = passes >= 2 && !line.hasRotation;

          if (canRelativeRebuild) {
            if (!this.absGapCssInjected) {
              this.extraCssRules.push('.pdf-abs-gap { display: inline-block; font-size: 0; line-height: 0; }');
              this.absGapCssInjected = true;
            }
            html.push(
              `<div class="pdf-abs-line" style="position: absolute; left: 0; top: ${lineTop}px; width: ${width}px; height: ${effectiveLineHeight}px; white-space: pre; line-height: ${effectiveLineHeight}px;">`
            );

            let cursorX = 0;
            for (const run of mergedRuns) {
              const fontClass = this.getFontClass(run, fontMappings);
              const xRel = run.x - region.rect.left;
              const gap = xRel - cursorX;
              if (gap > 0.5) {
                const w = Math.round(gap * 1000) / 1000;
                html.push(`<span class="pdf-abs-gap" style="width: ${w}px"></span>`);
              }
              const inline = this.layoutEngine.generateInlineTextSpan(run, fontClass);
              const runWidth = Math.max(0, Math.round(Math.max(0, run.width) * 1000) / 1000);
              html.push(`<span style="display: inline-block; width: ${runWidth}px;">${inline}</span>`);
              cursorX = Math.max(cursorX, xRel + Math.max(0, run.width));
            }

            html.push('</div>');
          } else {
            html.push(
              `<div class="pdf-abs-line" style="position: absolute; left: 0; top: ${lineTop}px; width: ${width}px; height: ${effectiveLineHeight}px;">`
            );

            for (const run of mergedRuns) {
              const fontClass = this.getFontClass(run, fontMappings);
              const abs = this.layoutEngine.transformCoordinates(run.x, run.y, page.height, run.height);
              const rel = {
                x: abs.x - region.rect.left,
                y: abs.y - region.rect.top - lineTop
              };
              html.push(this.layoutEngine.generateTextElement(run, page.height, fontClass, { coordsOverride: rel }));
            }

            html.push('</div>');
          }
        }

        html.push('</div>');
        continue;
      }

      html.push(
        `<div class="pdf-text-region" style="position: absolute; left: ${region.rect.left}px; top: ${region.rect.top}px; width: ${width}px; height: ${height}px;" data-x="${region.rect.left}" data-top="${region.rect.top}" data-width="${width}" data-height="${height}" data-obstacle-distance="${Math.round(region.nearestObstacleDistance * 100) / 100}">`
      );

      for (const paragraph of region.paragraphs) {
        const dominant = paragraph.dominant;
        const fontClass = this.getFontClass(dominant, fontMappings);
        const lineHeight = Math.max(1, Math.round(paragraph.lineHeight * 1000) / 1000);
        const flowStyle: Record<string, string> = {
          position: 'relative',
          'white-space': 'normal',
          'line-height': `${lineHeight}px`,
          ...(passes >= 2 ? {} : { 'font-size': `${dominant.fontSize}px`, color: dominant.color })
        };
        if (passes < 2) {
          if (dominant.fontWeight && dominant.fontWeight !== 400) flowStyle['font-weight'] = String(dominant.fontWeight);
          if (dominant.fontStyle && dominant.fontStyle !== 'normal') flowStyle['font-style'] = dominant.fontStyle;
        }

        const flowClass = this.getFlowStyleClass(flowStyle);

        const mt = Math.max(0, Math.round(paragraph.gapBefore * 1000) / 1000);
        const indents = paragraph.lines.map((l) => l.indent);
        const minIndent = indents.length > 0 ? Math.max(0, Math.round(Math.min(...indents) * 1000) / 1000) : 0;
        const firstIndent = indents.length > 0 ? Math.max(0, Math.round(indents[0] * 1000) / 1000) : 0;
        const textIndent = Math.round((firstIndent - minIndent) * 1000) / 1000;

        const inlineParts: string[] = [];
        if (mt > 0) inlineParts.push(`margin-top: ${mt}px`);
        if (minIndent > 0) inlineParts.push(`padding-left: ${minIndent}px`);
        if (Math.abs(textIndent) > 0.01) inlineParts.push(`text-indent: ${textIndent}px`);
        const inlineStyle = inlineParts.length > 0 ? ` style="${inlineParts.join('; ')}"` : '';

        let paragraphBody: string;

        if (passes >= 2) {
          const parts: string[] = [];

          for (let i = 0; i < paragraph.lines.length; i++) {
            const lineEntry = paragraph.lines[i];

            if (i > 0 && !lineEntry.joinWithPrev) {
              parts.push(' ');
            }

            const sourceLine = lineEntry.sourceLine;
            if (!sourceLine) {
              const fallback = (lineEntry.text || '').trim();
              if (fallback.length > 0) parts.push(this.escapeHtml(fallback));
              continue;
            }

            let tokens = this.regionLayoutAnalyzer.reconstructLineTokens(sourceLine.items) as LineToken[];
            const nextEntry = paragraph.lines[i + 1];
            if (nextEntry?.joinWithPrev === 'hyphenation') {
              tokens = this.stripTrailingSoftHyphen(tokens);
            }

            parts.push(this.renderTokens(tokens, fontMappings));
          }

          paragraphBody = parts.join('');
        } else {
          const mergedText = paragraph.lines
            .map((l) => (l.text || '').trim())
            .filter((t) => t.length > 0)
            .join(' ');
          paragraphBody = this.escapeHtml(mergedText);
        }

        html.push(`<p class="${fontClass} ${flowClass}"${inlineStyle}>${paragraphBody}</p>`);
      }

      html.push('</div>');
    }

    return html.join('\n');
  }

  private mergeTextRuns(items: PDFTextContent[]): PDFTextContent[] {
    return this.regionLayoutAnalyzer.mergeTextRuns(items);
  }

  private renderTokens(tokens: LineToken[], fontMappings: FontMapping[]): string {
    const out: string[] = [];
    for (const tok of tokens) {
      if (tok.type === 'space') {
        out.push(' ');
        continue;
      }

      const sample = tok.sample;
      const fontClass = this.getFontClass(sample.fontInfo?.name || sample.fontFamily, fontMappings);
      out.push(this.layoutEngine.generateInlineTextSpan({ ...sample, text: tok.text }, fontClass));
    }
    return out.join('');
  }

  private stripTrailingSoftHyphen(tokens: LineToken[]): LineToken[] {
    if (!tokens || tokens.length === 0) return tokens;
    const out = [...tokens];
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i];
      if (t.type === 'space') continue;
      if (!t.text) break;
      if (!t.text.endsWith('\u00AD')) break;

      const nextText = t.text.slice(0, -1);
      if (nextText.length === 0) {
        out.splice(i, 1);
      } else {
        out[i] = { ...t, text: nextText };
      }
      break;
    }
    return out;
  }

  private toFontClassSuffix(name: string): string {
    return String(name || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  }

  private getFontClass(fontOrText: string | PDFTextContent, fontMappings: FontMapping[]): string {
    const candidates: string[] = [];
    const rawCandidates: string[] = [];

    if (typeof fontOrText === 'string') {
      rawCandidates.push(fontOrText);
      const key = normalizeFontName(fontOrText || '').family;
      if (key) candidates.push(key);
    } else {
      const byInfo = fontOrText.fontInfo?.name || '';
      const byFamily = fontOrText.fontFamily || '';
      if (byInfo) rawCandidates.push(byInfo);
      if (byFamily) rawCandidates.push(byFamily);

      const infoKey = normalizeFontName(byInfo).family;
      const famKey = normalizeFontName(byFamily).family;
      if (infoKey) candidates.push(infoKey);
      if (famKey && famKey !== infoKey) candidates.push(famKey);
    }

    const mapping = fontMappings.find((m) => {
      const famKey = normalizeFontName(m.detectedFont.family || '').family;
      const nameKey = normalizeFontName(m.detectedFont.name || '').family;
      return candidates.some((c) => (c && famKey === c) || (c && nameKey === c)) ||
        rawCandidates.some((r) => (r && m.detectedFont.family === r) || (r && m.detectedFont.name === r));
    });

    if (!mapping) return 'font-default';

    // Must match CSSGenerator's class naming (based on googleFont.family).
    return `font-${this.toFontClassSuffix(mapping.googleFont.family)}`;
  }

  private generateFormElement(form: PDFFormContent, pageHeight: number): string {
    const coords = this.layoutEngine.transformCoordinates(form.x, form.y, pageHeight);
    const escapedValue = typeof form.value === 'string' 
      ? form.value.replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      : String(form.value);
    const style = `position: absolute; left: ${coords.x}px; top: ${coords.y}px; width: ${form.width}px; height: ${form.height}px;`;
    
    switch (form.type) {
      case 'text':
        return `<input type="text" name="${form.name}" value="${escapedValue}" style="${style}" ${form.readonly ? 'readonly' : ''} />`;
      case 'checkbox':
        return `<input type="checkbox" name="${form.name}" ${form.value ? 'checked' : ''} style="${style}" />`;
      case 'radio':
        return `<input type="radio" name="${form.name}" ${form.value ? 'checked' : ''} style="${style}" />`;
      case 'button':
        return `<button name="${form.name}" style="${style}">${escapedValue}</button>`;
      case 'dropdown':
        return `<select name="${form.name}" style="${style}"><option>${escapedValue}</option></select>`;
      default:
        return '';
    }
  }

  private generateAnnotationElement(annotation: PDFAnnotation, pageHeight: number): string {
    const coords = this.layoutEngine.transformCoordinates(annotation.x, annotation.y, pageHeight);
    const style = `position: absolute; left: ${coords.x}px; top: ${coords.y}px; width: ${annotation.width}px; height: ${annotation.height}px;`;
    const escapedContent = annotation.content ? annotation.content.replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
    const escapedUrl = annotation.url ? annotation.url.replace(/"/g, '&quot;') : '';
    
    switch (annotation.type) {
      case 'link':
        return annotation.url 
          ? `<a href="${escapedUrl}" style="${style}">${escapedContent}</a>`
          : '';
      case 'note':
        return `<div class="annotation-note" style="${style}" title="${escapedContent}">📝</div>`;
      case 'highlight':
        return `<div class="annotation-highlight" style="${style}; background: yellow; opacity: 0.3;">${escapedContent}</div>`;
      case 'underline':
        return `<span class="annotation-underline" style="${style}; text-decoration: underline;">${escapedContent}</span>`;
      case 'strikeout':
        return `<span class="annotation-strikeout" style="${style}; text-decoration: line-through;">${escapedContent}</span>`;
      default:
        return '';
    }
  }

  private generateCSS(
    fontMappings: FontMapping[],
    pages: PDFPage[]
  ): string {
    const base = this.cssGenerator.generate(fontMappings, pages);
    const rules = [...this.layoutEngine.getExtraCssRules(), ...this.extraCssRules];
    if (rules.length === 0) return base;
    return [base, rules.join('\n\n')].join('\n\n');
  }

  private formatOutput(html: string, css: string): string {
    let out = html;

    if (this.options.layoutAdapter?.mode === 'flex') {
      try {
        out = adaptAbsoluteToFlex(out, this.options.layoutAdapter);
      } catch {
        // ignore adapter errors to keep conversion resilient
      }
    }

    if (this.options.format === 'html+inline-css') {
      return out.replace(
        '</head>',
        `<style>${css}</style></head>`
      );
    }

    return out;
  }

  private extractFontFamilies(fontMappings: FontMapping[]): string[] {
    return Array.from(
      new Set(fontMappings.map((m) => m.googleFont.family))
    );
  }

  private extractDocumentText(document: PDFDocument): string {
    const pages: string[] = [];
    for (const page of document.pages) {
      const pageText = this.extractPageText(page);
      if (pageText) pages.push(pageText);
    }
    return pages.join('\n\n');
  }

  private extractPageText(page: PDFPage): string {
    const analysis = this.regionLayoutAnalyzer.analyze(page);
    const regions = [...analysis.regions].sort((a, b) => {
      const yDiff = a.rect.top - b.rect.top;
      if (Math.abs(yDiff) > 0.5) return yDiff;
      return a.minX - b.minX;
    });

    const out: string[] = [];

    const mergeLineBreakContinuation = (a: string, b: string): { merged: string; joined: boolean } => {
      const aTrim = a.replace(/\s+$/g, '');
      const bTrim = b.replace(/^\s+/g, '');

      if (aTrim.length === 0 || bTrim.length === 0) {
        return { merged: aTrim, joined: false };
      }

      const aEndsWithShortCapPrefix = /[A-Z][a-z]{0,2}$/.test(aTrim);
      const bStartsLowerContinuation = /^[a-z]{3,}/.test(bTrim);
      const aEndsWithPunct = /(?:\]|\[|\)|\(|\}|\{|,|\.|;|:|!|\?)$/.test(aTrim);

      if (aEndsWithShortCapPrefix && bStartsLowerContinuation && !aEndsWithPunct) {
        return { merged: aTrim + bTrim, joined: true };
      }

      return { merged: aTrim, joined: false };
    };

    for (const region of regions) {
      if (region.flowAllowed && region.paragraphs.length > 0) {
        for (const paragraph of region.paragraphs) {
          const mergedText = paragraph.lines
            .map((l) => (l.text || '').trim())
            .filter((t) => t.length > 0)
            .join(' ');
          if (mergedText) out.push(mergedText);
        }
        continue;
      }

      const orderedLines = [...region.lines].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 0.5) return yDiff;
        return a.minX - b.minX;
      });

      for (const line of orderedLines) {
        const lineText = this.regionLayoutAnalyzer.reconstructLineText(line.items);
        if (!lineText) continue;
        const prev = out.length > 0 ? out[out.length - 1] : undefined;
        if (prev) {
          const merged = mergeLineBreakContinuation(prev, lineText);
          if (merged.joined) {
            out[out.length - 1] = merged.merged;
            continue;
          }
        }
        out.push(lineText);
      }
    }

    return out.join('\n');
  }

  private generateGraphicsSVG(
    graphics: PDFGraphicsContent[],
    pageWidth: number,
    pageHeight: number
  ): string {
    if (graphics.length === 0) {
      return '';
    }

    const parts: string[] = [];
    parts.push(`<svg width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}" class="pdf-graphics" style="position: absolute; top: 0; left: 0; pointer-events: none;">`);

    for (const graphic of graphics) {
      parts.push(this.generateGraphicElement(graphic));
    }

    parts.push('</svg>');
    return parts.join('\n');
  }

  private generateGraphicElement(graphic: PDFGraphicsContent): string {
    const attrs: string[] = [];

    if (graphic.stroke) {
      attrs.push(`stroke="${graphic.stroke}"`);
    }

    if (graphic.strokeOpacity !== undefined) {
      attrs.push(`stroke-opacity="${graphic.strokeOpacity}"`);
    }

    if (graphic.fill) {
      attrs.push(`fill="${graphic.fill}"`);
    } else {
      attrs.push('fill="none"');
    }

    if (graphic.fillRule) {
      attrs.push(`fill-rule="${graphic.fillRule}"`);
    }

    if (graphic.fillOpacity !== undefined) {
      attrs.push(`fill-opacity="${graphic.fillOpacity}"`);
    }

    if (graphic.strokeWidth) {
      attrs.push(`stroke-width="${graphic.strokeWidth}"`);
    }

    if (graphic.lineCap) {
      attrs.push(`stroke-linecap="${graphic.lineCap}"`);
    }

    if (graphic.lineJoin) {
      attrs.push(`stroke-linejoin="${graphic.lineJoin}"`);
    }

    const attrString = attrs.join(' ');

    switch (graphic.type) {
      case 'path':
        return graphic.path ? `<path d="${graphic.path}" ${attrString} />` : '';

      case 'rectangle':
        return graphic.x !== undefined && graphic.y !== undefined && typeof graphic.width === 'number' && typeof graphic.height === 'number'
          ? `<rect x="${graphic.x}" y="${graphic.y}" width="${graphic.width}" height="${graphic.height}" ${attrString} />`
          : '';

      case 'circle':
        return graphic.x !== undefined && graphic.y !== undefined && graphic.width
          ? `<circle cx="${graphic.x + graphic.width / 2}" cy="${graphic.y + graphic.width / 2}" r="${graphic.width / 2}" ${attrString} />`
          : '';

      case 'line':
        return graphic.x !== undefined && graphic.y !== undefined && typeof graphic.width === 'number' && typeof graphic.height === 'number'
          ? `<line x1="${graphic.x}" y1="${graphic.y}" x2="${graphic.x + graphic.width}" y2="${graphic.y + graphic.height}" ${attrString} />`
          : '';

      case 'curve':
        // For curves, we'll render as a path if available, otherwise skip
        return graphic.path ? `<path d="${graphic.path}" ${attrString} />` : '';

      case 'raster':
        return graphic.data && graphic.width && graphic.height
          ? `<image href="${graphic.data}" x="${graphic.x ?? 0}" y="${graphic.y ?? 0}" width="${graphic.width}" height="${graphic.height}" ${attrString} />`
          : '';

      default:
        return '';
    }
  }

  private escapeHtml(text: string): string {
    if (typeof document !== 'undefined') {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private getFlowStyleClass(style: Record<string, string>): string {
    const entries = Object.entries(style)
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const key = entries.map(([k, v]) => `${k}:${v}`).join(';');

    const existing = this.flowStyleClassByKey.get(key);
    if (existing) return existing;

    const className = `pdf-flow-style-${this.flowStyleClassByKey.size}`;
    this.flowStyleClassByKey.set(key, className);

    const decls = entries.map(([k, v]) => `  ${k}: ${v};`).join('\n');
    this.extraCssRules.push(`.${className} {\n${decls}\n}`);
    return className;
  }
}
