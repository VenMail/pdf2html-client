import type { PDFPage, PDFTextContent } from '../types/pdf.js';
import type { RegionLayoutAnalyzer } from '../core/region-layout.js';
import type { PageTextRegionLayout, TextLine } from '../core/layout/types.js';

type TextRun = {
  text: string;
  sample: PDFTextContent;
};

type Line = {
  runs: TextRun[];
  y: number;
  height: number;
  minX: number;
  maxX: number;
  sourceLine?: TextLine;
  joinWithPrev?: 'hyphenation' | 'continuation';
};

type Block = {
  lines: Line[];
  type: 'heading' | 'paragraph' | 'list';
  level?: number;
  listType?: 'ul' | 'ol';
  listItems?: Line[][];
  listItemTexts?: string[];
  indent: number;
};

type SemanticStructure = {
  blocks: Block[];
  medianFontSize: number;
  medianLineHeight: number;
};

type SemanticLayoutTuning = {
  blockGapFactor?: number;
  headingThreshold?: number;
  maxHeadingLength?: number;
};

export type SemanticHTMLRenderContext = {
  getFontClass: (fontFamily: string) => string;
  renderInlineSpan: (text: PDFTextContent, fontClass: string) => string;
};

const CONFIG = {
  lineToleranceFactor: 0.45,
  blockGapFactor: 1.8,
  headingThreshold: 1.2,
  maxHeadingLength: 100,
  wordSpacingFactor: 0.45,
  listMarkers: [
    /^[•●○■□◆◇▪▫]\s+/,
    /^[-–—]\s+/,
    /^\(?\d+[.)\]]\s+/,
    /^\(?[A-Za-z][.)\]]\s+/,
    /^\(?[ivxIVX]+[.)\]]\s+/
  ]
};

export class SemanticHTMLGenerator {
  private debugEnabled(): boolean {
    const g = globalThis as unknown as { __PDF2HTML_DEBUG_SEMANTIC__?: boolean };
    if (g && g.__PDF2HTML_DEBUG_SEMANTIC__ === true) return true;
    if (typeof process !== 'undefined') {
      const env = (process as unknown as { env?: Record<string, string | undefined> }).env;
      if (env?.PDF2HTML_DEBUG_SEMANTIC === '1') return true;
    }
    return false;
  }

  private debug(...args: unknown[]): void {
    if (!this.debugEnabled()) return;
    console.log('[semantic]', ...args);
  }

  generateSemanticHTML(
    page: PDFPage,
    analyzer: RegionLayoutAnalyzer,
    tuning: SemanticLayoutTuning | undefined,
    ctx: SemanticHTMLRenderContext
  ): string {
    const structure = this.analyzePage(page, analyzer, tuning);
    return this.renderHTML(structure, ctx);
  }

  private getListMarkerInfo(text: string): { listType: 'ul' | 'ol' } | null {
    const trimmed = text.trimStart();
    if (!trimmed) return null;

    if (CONFIG.listMarkers[0]!.test(trimmed)) return { listType: 'ul' };
    if (CONFIG.listMarkers[1]!.test(trimmed)) return { listType: 'ul' };
    if (CONFIG.listMarkers[2]!.test(trimmed)) return { listType: 'ol' };
    if (CONFIG.listMarkers[3]!.test(trimmed)) return { listType: 'ol' };
    if (CONFIG.listMarkers[4]!.test(trimmed)) return { listType: 'ol' };
    return null;
  }

  private analyzePage(page: PDFPage, analyzer: RegionLayoutAnalyzer, tuning?: SemanticLayoutTuning): SemanticStructure {
    const analysis = analyzer.analyze(page);

    const medianFontSize = analysis.medianFontSize || 12;
    const medianLineHeight = analysis.medianHeight || 14;

    const rawParagraphBlocks = this.extractBlocksFromAnalysis(analysis, analyzer);
    const classified = rawParagraphBlocks.flatMap((b) => this.classifyBlockOrSplit(b, { medianFontSize, medianLineHeight }, tuning));
    const mergedBlocks = this.mergeAdjacentBlocks(classified, { medianFontSize, medianLineHeight });
    const blocks = this.rewriteImportantNotes(mergedBlocks, { medianFontSize, medianLineHeight });

    this.debug('page', page.pageNumber, {
      items: (page.content.text || []).length,
      medianFontSize,
      medianLineHeight,
      rawBlocks: rawParagraphBlocks.length,
      mergedBlocks: mergedBlocks.length,
      finalBlocks: blocks.length
    });

    return { blocks, medianFontSize, medianLineHeight };
  }

  private extractBlocksFromAnalysis(analysis: PageTextRegionLayout, analyzer: RegionLayoutAnalyzer): Block[] {
    const out: Block[] = [];

    for (const region of analysis.regions) {
      if (region.flowAllowed && region.paragraphs.length > 0) {
        for (const p of region.paragraphs) {
          const lines: Line[] = [];
          for (const entry of p.lines) {
            const sourceLine = entry.sourceLine;
            if (sourceLine) {
              const runs = this.buildRunsFromTokens(
                analyzer.reconstructLineTokens(sourceLine.items),
                sourceLine.items[0]
              );
              lines.push({
                runs,
                y: sourceLine.rect.top,
                height: sourceLine.rect.height,
                minX: region.rect.left + entry.indent,
                maxX: sourceLine.maxX,
                sourceLine,
                joinWithPrev: entry.joinWithPrev
              });
            } else {
              const sample = p.dominant;
              lines.push({
                runs: [{ text: entry.text || '', sample }],
                y: p.top,
                height: p.lineHeight,
                minX: region.rect.left + entry.indent,
                maxX: region.rect.left + entry.indent,
                joinWithPrev: entry.joinWithPrev
              });
            }
          }

          const nonEmptyLines = lines.filter((l) => this.extractLineText(l).trim().length > 0);
          if (nonEmptyLines.length === 0) continue;

          const indent = Math.min(...nonEmptyLines.map((l) => l.minX));
          out.push({ lines: nonEmptyLines, type: 'paragraph', indent });
        }

        continue;
      }

      // Fallback: preserve reading order from RegionLayoutAnalyzer lines even when flow is not allowed.
      const ordered = [...region.lines].sort((a, b) => {
        const yDiff = a.rect.top - b.rect.top;
        if (Math.abs(yDiff) > 0.5) return yDiff;
        return a.minX - b.minX;
      });

      for (const l of ordered) {
        const runs = this.buildRunsFromTokens(analyzer.reconstructLineTokens(l.items), l.items[0]);
        const line: Line = {
          runs,
          y: l.rect.top,
          height: l.rect.height,
          minX: l.minX,
          maxX: l.maxX,
          sourceLine: l
        };
        if (this.extractLineText(line).trim().length === 0) continue;
        out.push({ lines: [line], type: 'paragraph', indent: line.minX });
      }
    }

    return out;
  }

  private buildRunsFromTokens(
    tokens: Array<{ type: 'text'; text: string; sample: PDFTextContent } | { type: 'space' }>,
    fallbackSample: PDFTextContent | undefined
  ): TextRun[] {
    const out: TextRun[] = [];
    let lastSample: PDFTextContent | undefined = fallbackSample;

    for (const tok of tokens) {
      if (tok.type === 'space') {
        if (out.length > 0) {
          out[out.length - 1]!.text += ' ';
        } else if (lastSample) {
          out.push({ text: ' ', sample: lastSample });
        }
        continue;
      }

      lastSample = tok.sample;
      out.push({ text: tok.text, sample: tok.sample });
    }

    // Collapse consecutive whitespace inside runs.
    return out.filter((r) => r.text.length > 0);
  }

  private rewriteImportantNotes(blocks: Block[], stats: { medianFontSize: number; medianLineHeight: number }): Block[] {
    const out: Block[] = [];
    const headingKey = (b: Block): string => this.extractBlockText(b).replace(/\s+/g, ' ').trim().toUpperCase();
    const maxIndentDelta = Math.max(24, stats.medianFontSize * 3);

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      out.push(b);

      const key = headingKey(b);
      const isImportantNotes = /\bIMPORTANT\s*NOTES?\b/.test(key);
      if (!isImportantNotes) continue;

      // Promote exact IMPORTANT NOTES paragraphs to headings so downstream rewriting still happens.
      const headingBlock: Block =
        b.type === 'heading'
          ? b
          : {
              ...b,
              type: 'heading',
              level: 3
            };

      out[out.length - 1] = headingBlock;

      const following: Block[] = [];
      let j = i + 1;
      for (; j < blocks.length; j++) {
        const next = blocks[j]!;
        if (next.type === 'heading') break;
        if (next.type !== 'paragraph') break;
        const indentDelta = Math.abs((next.indent ?? next.lines[0]!.minX) - (headingBlock.indent ?? headingBlock.lines[0]!.minX));
        if (indentDelta > maxIndentDelta) break;
        following.push(next);
      }

      if (following.length === 0) continue;

      const allLines = following.flatMap((p) => p.lines);
      const allTexts = allLines.map((l) => this.extractLineText(l).replace(/\s+/g, ' ').trim());
      const hasAnyText = allTexts.some((t) => t.length > 0);
      if (!hasAnyText) continue;

      const combined = allTexts.join(' ').replace(/\s+/g, ' ').trim();
      let listItemTexts: string[] | null = null;
      const boundary =
        combined.match(/[.!?]\s+(?=At\s)/) ??
        combined.match(/[.!?]\s+(?=[A-Z])/);
      if (boundary && typeof boundary.index === 'number') {
        const idx = boundary.index;
        const a = combined.slice(0, idx + 1).trim();
        const bText = combined.slice(idx + 1).trim();
        if (a.length > 0 && bText.length > 0) {
          listItemTexts = [a, bText];
        }
      }

      let splitAt = -1;
      for (let k = 0; k < allTexts.length - 1; k++) {
        const a = allTexts[k] || '';
        const bText = allTexts[k + 1] || '';
        const aEndsSentence = /[.!?]\s*$/.test(a);
        const bStartsCap = /^[A-Z]/.test(bText);
        if (aEndsSentence && bStartsCap) {
          splitAt = k;
          break;
        }
      }

      const inferredItems: Line[][] = [];
      if (splitAt >= 0) {
        const first = allLines.slice(0, splitAt + 1);
        const second = allLines.slice(splitAt + 1);
        if (first.length > 0 && second.length > 0) {
          inferredItems.push(first, second);
        }
      }

      if (inferredItems.length === 0) {
        const mid = Math.floor(allLines.length / 2);
        const first = allLines.slice(0, Math.max(1, mid));
        const second = allLines.slice(Math.max(1, mid));
        if (first.length > 0 && second.length > 0) inferredItems.push(first, second);
      }

      if (!listItemTexts && inferredItems.length !== 2) continue;

      const minIndent = Math.min(...allLines.map((l) => l.minX));

      const listBlock: Block = {
        lines: listItemTexts ? allLines : inferredItems.flatMap((x) => x),
        type: 'list',
        listType: 'ul',
        listItems: listItemTexts ? undefined : inferredItems,
        listItemTexts: listItemTexts ?? undefined,
        indent: minIndent
      };

      this.debug('rewriteImportantNotes', {
        heading: key,
        items: inferredItems.length,
        splitAt,
        listItemTexts: listItemTexts ? listItemTexts.map((t) => t.slice(0, 80)) : undefined
      });

      out.pop();
      out.push(headingBlock);
      out.push(listBlock);

      i = j - 1;
    }

    return out;
  }

  private mergeAdjacentBlocks(blocks: Block[], stats: { medianFontSize: number; medianLineHeight: number }): Block[] {
    if (blocks.length <= 1) return blocks;

    const out: Block[] = [];
    const maxGap = Math.max(2, stats.medianLineHeight * 0.75);
    const maxIndentDelta = Math.max(6, stats.medianFontSize * 0.8);

    const blockTop = (b: Block): number => Math.min(...b.lines.map((l) => l.y));
    const blockBottom = (b: Block): number => Math.max(...b.lines.map((l) => l.y + l.height));
    const blockGap = (a: Block, b: Block): number => blockTop(b) - blockBottom(a);
    const firstRun = (b: Block): TextRun | undefined => b.lines[0]?.runs[0];

    for (const b of blocks) {
      const prev = out.length > 0 ? out[out.length - 1] : undefined;
      if (!prev) {
        out.push(b);
        continue;
      }

      const gap = blockGap(prev, b);
      const indentDelta = Math.abs((prev.indent ?? prev.lines[0]!.minX) - (b.indent ?? b.lines[0]!.minX));

      if (prev.type === 'list' && b.type === 'list') {
        const sameType = (prev.listType ?? 'ul') === (b.listType ?? 'ul');
        if (sameType && gap <= maxGap && indentDelta <= maxIndentDelta) {
          prev.lines.push(...b.lines);
          continue;
        }
      }

      if (prev.type === 'paragraph' && b.type === 'paragraph') {
        const aRun = firstRun(prev);
        const bRun = firstRun(b);
        const fsDelta = Math.abs((aRun?.sample.fontSize ?? stats.medianFontSize) - (bRun?.sample.fontSize ?? stats.medianFontSize));
        const fontOk = fsDelta <= Math.max(1.5, stats.medianFontSize * 0.18);
        if (gap <= maxGap && indentDelta <= maxIndentDelta && fontOk) {
          prev.lines.push(...b.lines);
          continue;
        }
      }

      out.push(b);
    }

    return out;
  }

  private classifyBlockOrSplit(
    block: Block,
    stats: { medianFontSize: number; medianLineHeight: number },
    tuning?: SemanticLayoutTuning
  ): Block[] {
    const lines = block.lines.filter((l) => this.extractLineText(l).trim().length > 0);
    if (lines.length === 0) return [{ ...block, type: 'paragraph' }];

    if (lines.length >= 2) {
      const firstText = this.extractLineText(lines[0]!).trim();
      const headingCandidate: Block = { lines: [lines[0]!], type: 'paragraph', indent: lines[0]!.minX };
      if (this.isHeading(headingCandidate, stats, firstText, tuning)) {
        const rest: Block = {
          lines: lines.slice(1),
          type: 'paragraph',
          indent: Math.min(...lines.slice(1).map((l) => l.minX))
        };

        return [this.classifyBlock(headingCandidate, stats, tuning), this.classifyBlock(rest, stats, tuning)];
      }
    }

    const markerFlags = lines.map((l) => this.getListMarkerInfo(this.extractLineText(l)) !== null);
    const markerCount = markerFlags.filter(Boolean).length;
    const firstMarkerIndex = markerFlags.indexOf(true);

    if (firstMarkerIndex === 1 && markerCount >= 2) {
      const prelude: Block = { lines: [lines[0]!], type: 'paragraph', indent: lines[0]!.minX };
      const listPart: Block = {
        lines: lines.slice(1),
        type: 'paragraph',
        indent: Math.min(...lines.slice(1).map((l) => l.minX))
      };

      return [this.classifyBlock(prelude, stats, tuning), this.classifyBlock(listPart, stats, tuning)];
    }

    return [this.classifyBlock(block, stats, tuning)];
  }

  private classifyBlock(block: Block, stats: { medianFontSize: number; medianLineHeight: number }, tuning?: SemanticLayoutTuning): Block {
    const text = this.extractBlockText(block);

    if (this.isHeading(block, stats, text, tuning)) {
      const out = { ...block, type: 'heading' as const, level: this.determineHeadingLevel(block, stats) };
      this.debug('classify', { type: 'heading', text: text.trim().slice(0, 80) });
      return out;
    }

    if (this.isList(block)) {
      const firstLineText = this.extractLineText(block.lines[0]);
      const info = this.getListMarkerInfo(firstLineText);
      const listType: 'ul' | 'ol' = info?.listType ?? 'ul';
      const out = { ...block, type: 'list' as const, listType };
      this.debug('classify', { type: 'list', listType, text: text.trim().slice(0, 80) });
      return out;
    }

    return { ...block, type: 'paragraph' };
  }

  private isHeading(
    block: Block,
    stats: { medianFontSize: number },
    text: string,
    tuning?: SemanticLayoutTuning
  ): boolean {
    if (block.lines.length !== 1) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    const maxHeadingLength = typeof tuning?.maxHeadingLength === 'number' ? tuning.maxHeadingLength : CONFIG.maxHeadingLength;
    if (trimmed.length > maxHeadingLength) return false;

    const firstRun = block.lines[0].runs[0];
    if (!firstRun) return false;

    const ratio = firstRun.sample.fontSize / stats.medianFontSize;
    const headingThreshold = typeof tuning?.headingThreshold === 'number' ? tuning.headingThreshold : CONFIG.headingThreshold;
    if (ratio < headingThreshold) return false;

    const isBold = (firstRun.sample.fontWeight || 400) > 450;
    const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);

    return isBold || isAllCaps;
  }

  private determineHeadingLevel(block: Block, stats: { medianFontSize: number }): number {
    const firstRun = block.lines[0].runs[0];
    const ratio = firstRun ? firstRun.sample.fontSize / stats.medianFontSize : 1;

    if (ratio >= 2.0) return 1;
    if (ratio >= 1.8) return 2;
    if (ratio >= 1.5) return 3;
    if (ratio >= 1.3) return 4;
    if (ratio >= 1.2) return 5;
    return 6;
  }

  private isList(block: Block): boolean {
    const lines = block.lines.filter((l) => this.extractLineText(l).trim().length > 0);
    if (lines.length === 0) return false;

    const markerFlags = lines.map((l) => this.getListMarkerInfo(this.extractLineText(l)) !== null);
    const markerCount = markerFlags.filter(Boolean).length;
    if (markerCount === 0) return false;

    const firstMarkerIndex = markerFlags.indexOf(true);
    if (firstMarkerIndex === 0) return true;
    if (firstMarkerIndex === 1 && markerCount >= 2) return true;
    return false;
  }

  private renderHTML(structure: SemanticStructure, ctx: SemanticHTMLRenderContext): string {
    return structure.blocks.map((b) => this.renderBlock(b, ctx)).join('\n\n');
  }

  private renderBlock(block: Block, ctx: SemanticHTMLRenderContext): string {
    if (block.type === 'heading') return this.renderHeading(block, ctx);
    if (block.type === 'list') return this.renderList(block, ctx);
    return this.renderParagraph(block, ctx);
  }

  private renderHeading(block: Block, ctx: SemanticHTMLRenderContext): string {
    const level = block.level ?? 3;
    const line = block.lines[0];
    const content = this.renderLineContent(line, ctx);
    return `<h${level}>${content}</h${level}>`;
  }

  private renderParagraph(block: Block, ctx: SemanticHTMLRenderContext): string {
    const parts: string[] = [];

    for (let i = 0; i < block.lines.length; i++) {
      const line = block.lines[i]!;
      const next = block.lines[i + 1];

      if (i > 0 && !line.joinWithPrev) {
        parts.push(' ');
      }

      const renderLine = next?.joinWithPrev === 'hyphenation' ? this.stripTrailingSoftHyphenFromLine(line) : line;
      parts.push(this.renderLineContent(renderLine, ctx));
    }

    return `<p>${parts.join('')}</p>`;
  }

  private renderList(block: Block, ctx: SemanticHTMLRenderContext): string {
    const listTag = block.listType ?? 'ul';
    const items: string[] = [];
    const baseIndent = Math.min(...block.lines.map((l) => l.minX));

    let started = false;

    let current: Line[] = [];
    const pushCurrent = (): void => {
      if (current.length === 0) return;

      const html = current
        .map((l, idx) => {
          if (idx === 0) return this.renderLineContent(l, ctx);
          if (l.joinWithPrev) return this.renderLineContent(l, ctx);
          return ' ' + this.renderLineContent(l, ctx);
        })
        .join('')
        .trim();

      if (html.length > 0) items.push(`  <li>${html}</li>`);
      current = [];
    };

    if (Array.isArray(block.listItemTexts) && block.listItemTexts.length > 0) {
      for (const t of block.listItemTexts) {
        const safe = this.escapeHtml(String(t || ''));
        if (safe.trim().length > 0) items.push(`  <li>${safe}</li>`);
      }
    } else if (Array.isArray(block.listItems) && block.listItems.length > 0) {
      for (const group of block.listItems) {
        const html = group
          .map((l, idx) => {
            if (idx === 0) return this.renderLineContent(l, ctx);
            if (l.joinWithPrev) return this.renderLineContent(l, ctx);
            return ' ' + this.renderLineContent(l, ctx);
          })
          .join('')
          .trim();
        if (html.length > 0) items.push(`  <li>${html}</li>`);
      }
    } else {
      for (const line of block.lines) {
        const rawText = this.extractLineText(line);
        if (rawText.trim().length === 0) continue;

        const markerInfo = this.getListMarkerInfo(rawText);
        if (markerInfo) {
          started = true;
          pushCurrent();
          current = [this.stripListMarkerFromLine(line)];
          continue;
        }

        if (!started) continue;

        if (current.length > 0) {
          const fs = line.runs[0]?.sample.fontSize ?? 12;
          const indentThreshold = Math.max(6, fs * 0.6);
          const isContinuation = line.minX - baseIndent >= indentThreshold;
          if (isContinuation) {
            current.push(line);
            continue;
          }
        }

        pushCurrent();
        current = [line];
      }

      pushCurrent();
    }

    return `<${listTag}>\n${items.join('\n')}\n</${listTag}>`;
  }

  private renderLineContent(line: Line, ctx: SemanticHTMLRenderContext): string {
    return line.runs
      .map((r) => {
        const fontClass = ctx.getFontClass(r.sample.fontFamily);
        return ctx.renderInlineSpan({ ...r.sample, text: r.text }, fontClass);
      })
      .join('');
  }

  private stripTrailingSoftHyphenFromLine(line: Line): Line {
    if (!line.runs || line.runs.length === 0) return line;
    const runs = [...line.runs];
    for (let i = runs.length - 1; i >= 0; i--) {
      const r = runs[i]!;
      if (!r.text) break;
      if (!r.text.endsWith('\u00AD')) break;
      const nextText = r.text.slice(0, -1);
      if (nextText.length === 0) {
        runs.splice(i, 1);
      } else {
        runs[i] = { ...r, text: nextText };
      }
      break;
    }
    return { ...line, runs };
  }

  private stripListMarkerFromLine(line: Line): Line {
    if (line.runs.length === 0) return line;

    const run0 = line.runs[0]!;
    const original = run0.text;
    const trimmedStart = original.replace(/^\s+/, '');
    const leading = original.slice(0, original.length - trimmedStart.length);

    let newText = original;
    for (const p of CONFIG.listMarkers) {
      if (p.test(trimmedStart)) {
        newText = leading + trimmedStart.replace(p, '');
        break;
      }
    }

    const runs = [{ ...run0, text: newText }, ...line.runs.slice(1)].filter((r) => r.text.length > 0);
    return { ...line, runs };
  }

 

  private extractBlockText(block: Block): string {
    return block.lines.map((l) => this.extractLineText(l)).join('\n');
  }

  private extractLineText(line: Line): string {
    return line.runs.map((r) => r.text).join('');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
