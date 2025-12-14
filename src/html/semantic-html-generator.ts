import type { PDFPage, PDFTextContent } from '../types/pdf.js';
import type { FontMapping } from '../types/fonts.js';
import type { RegionLayoutAnalyzer } from '../core/region-layout.js';
import { getDefaultFontMetricsResolver } from '../fonts/font-metrics-resolver.js';
import { normalizeFontName } from '../fonts/font-name-normalizer.js';

type TextRun = {
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: string;
  color: string;
};

type Line = {
  runs: TextRun[];
  y: number;
  height: number;
  minX: number;
  maxX: number;
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
  private debugFontSeen: Set<string> = new Set();

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

  generateSemanticHTML(page: PDFPage, fontMappings: FontMapping[], analyzer: RegionLayoutAnalyzer): string {
    const structure = this.analyzePage(page, analyzer);
    return this.renderHTML(structure, fontMappings);
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

  private analyzePage(page: PDFPage, analyzer: RegionLayoutAnalyzer): SemanticStructure {
    const items = (page.content.text || []).filter((t) => t.text && t.text.trim().length > 0);

    const fontSizes = items.map((t) => t.fontSize).sort((a, b) => a - b);
    const heights = items.map((t) => Math.max(1, t.height)).sort((a, b) => a - b);
    const medianFontSize = fontSizes[Math.floor(fontSizes.length / 2)] || 12;
    const medianLineHeight = heights[Math.floor(heights.length / 2)] || 14;

    const lines = this.groupIntoLines(page, items, analyzer);
    const rawBlocks = this.groupIntoBlocks(lines, { medianFontSize, medianLineHeight });
    const mergedBlocks = this.mergeAdjacentBlocks(rawBlocks, { medianFontSize, medianLineHeight });
    const blocks = this.rewriteImportantNotes(mergedBlocks, { medianFontSize, medianLineHeight });

    this.debug('page', page.pageNumber, {
      items: items.length,
      medianFontSize,
      medianLineHeight,
      lines: lines.length,
      rawBlocks: rawBlocks.length,
      mergedBlocks: mergedBlocks.length,
      finalBlocks: blocks.length
    });

    return { blocks, medianFontSize, medianLineHeight };
  }

  private rewriteImportantNotes(blocks: Block[], stats: { medianFontSize: number; medianLineHeight: number }): Block[] {
    const out: Block[] = [];
    const headingKey = (b: Block): string => this.extractBlockText(b).replace(/\s+/g, ' ').trim().toUpperCase();
    const maxIndentDelta = Math.max(24, stats.medianFontSize * 3);

    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]!;
      out.push(b);

      if (b.type !== 'heading') continue;
      const key = headingKey(b);
      if (!/^IMPORTANT\s*NOTES?$/.test(key)) continue;

      const following: Block[] = [];
      let j = i + 1;
      for (; j < blocks.length; j++) {
        const next = blocks[j]!;
        if (next.type === 'heading') break;
        if (next.type !== 'paragraph') break;
        const indentDelta = Math.abs((next.indent ?? next.lines[0]!.minX) - (b.indent ?? b.lines[0]!.minX));
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
      out.push(b);
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
        const fsDelta = Math.abs((aRun?.fontSize ?? stats.medianFontSize) - (bRun?.fontSize ?? stats.medianFontSize));
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

  private groupIntoLines(
    page: PDFPage,
    items: PDFTextContent[],
    analyzer: RegionLayoutAnalyzer
  ): Line[] {
    // Reuse the authoritative line grouping from RegionLayoutAnalyzer so punctuation-only glyphs
    // (e.g. '.', ':') that often have slightly different y/height still get assigned to the right line.
    // We only need the line geometry + per-line token reconstruction.
    const analysis = analyzer.analyze({
      ...page,
      content: {
        ...page.content,
        text: items
      }
    });

    return analysis.lines
      .map((l) => {
        const tokens = analyzer.reconstructLineTokens(l.items);
        const runs: TextRun[] = [];
        for (const tok of tokens) {
          if (tok.type !== 'text') continue;
          const sample = tok.sample;
          runs.push({
            text: tok.text,
            fontFamily: sample.fontFamily,
            fontSize: sample.fontSize,
            fontWeight: sample.fontWeight || 400,
            fontStyle: sample.fontStyle || 'normal',
            color: sample.color
          });
        }

        return {
          runs,
          y: l.rect.top,
          height: l.rect.height,
          minX: l.minX,
          maxX: l.maxX
        };
      })
      .filter((l) => l.runs.length > 0)
      .sort((a, b) => a.y - b.y);
  }

  private groupIntoBlocks(lines: Line[], stats: { medianFontSize: number; medianLineHeight: number }): Block[] {
    if (lines.length === 0) return [];

    const blocks: Block[] = [];
    const blockGapThreshold = stats.medianLineHeight * CONFIG.blockGapFactor;

    let current: Block | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : undefined;
      const verticalGap = prev ? line.y - (prev.y + prev.height) : 0;

      if (!current) {
        current = { lines: [line], type: 'paragraph', indent: line.minX };
        continue;
      }

      if (verticalGap > blockGapThreshold) {
        blocks.push(...this.classifyBlockOrSplit(current, stats));
        current = { lines: [line], type: 'paragraph', indent: line.minX };
        continue;
      }

      current.lines.push(line);
    }

    if (current) blocks.push(...this.classifyBlockOrSplit(current, stats));
    return blocks;
  }

  private classifyBlockOrSplit(block: Block, stats: { medianFontSize: number; medianLineHeight: number }): Block[] {
    const lines = block.lines.filter((l) => this.extractLineText(l).trim().length > 0);
    if (lines.length === 0) return [{ ...block, type: 'paragraph' }];

    if (lines.length >= 2) {
      const firstText = this.extractLineText(lines[0]!).trim();
      const headingCandidate: Block = { lines: [lines[0]!], type: 'paragraph', indent: lines[0]!.minX };
      if (this.isHeading(headingCandidate, stats, firstText)) {
        const rest: Block = {
          lines: lines.slice(1),
          type: 'paragraph',
          indent: Math.min(...lines.slice(1).map((l) => l.minX))
        };

        return [this.classifyBlock(headingCandidate, stats), this.classifyBlock(rest, stats)];
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

      return [this.classifyBlock(prelude, stats), this.classifyBlock(listPart, stats)];
    }

    return [this.classifyBlock(block, stats)];
  }

  private classifyBlock(block: Block, stats: { medianFontSize: number; medianLineHeight: number }): Block {
    const text = this.extractBlockText(block);

    if (this.isHeading(block, stats, text)) {
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

  private isHeading(block: Block, stats: { medianFontSize: number }, text: string): boolean {
    if (block.lines.length !== 1) return false;
    const trimmed = text.trim();
    if (trimmed.length === 0) return false;
    if (trimmed.length > CONFIG.maxHeadingLength) return false;

    const firstRun = block.lines[0].runs[0];
    if (!firstRun) return false;

    const ratio = firstRun.fontSize / stats.medianFontSize;
    if (ratio < CONFIG.headingThreshold) return false;

    const isBold = firstRun.fontWeight > 450;
    const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);

    return isBold || isAllCaps;
  }

  private determineHeadingLevel(block: Block, stats: { medianFontSize: number }): number {
    const firstRun = block.lines[0].runs[0];
    const ratio = firstRun ? firstRun.fontSize / stats.medianFontSize : 1;

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

  private renderHTML(structure: SemanticStructure, fontMappings: FontMapping[]): string {
    return structure.blocks.map((b) => this.renderBlock(b, fontMappings)).join('\n\n');
  }

  private renderBlock(block: Block, fontMappings: FontMapping[]): string {
    if (block.type === 'heading') return this.renderHeading(block, fontMappings);
    if (block.type === 'list') return this.renderList(block, fontMappings);
    return this.renderParagraph(block, fontMappings);
  }

  private renderHeading(block: Block, fontMappings: FontMapping[]): string {
    const level = block.level ?? 3;
    const line = block.lines[0];
    const content = this.renderLineContent(line, fontMappings);
    const style = this.generateInlineStyle(line.runs[0], fontMappings);
    return `<h${level} style="${style}">${content}</h${level}>`;
  }

  private renderParagraph(block: Block, fontMappings: FontMapping[]): string {
    const content = block.lines.map((l) => this.renderLineContent(l, fontMappings)).join(' ');
    const style = this.generateInlineStyle(block.lines[0].runs[0], fontMappings);
    return `<p style="${style}">${content}</p>`;
  }

  private renderList(block: Block, fontMappings: FontMapping[]): string {
    const listTag = block.listType ?? 'ul';
    const items: string[] = [];
    const baseIndent = Math.min(...block.lines.map((l) => l.minX));

    let started = false;

    let current: Line[] = [];
    const pushCurrent = (): void => {
      if (current.length === 0) return;

      const firstRun = this.findFirstNonEmptyRun(current[0]);
      const liStyle = this.generateInlineStyle(firstRun ?? current[0].runs[0], fontMappings);

      const html = current
        .map((l) => this.renderLineContent(l, fontMappings))
        .join(' ')
        .trim();

      if (html.length > 0) items.push(`  <li style="${liStyle}">${html}</li>`);
      current = [];
    };

    if (Array.isArray(block.listItemTexts) && block.listItemTexts.length > 0) {
      const firstRun = block.lines[0]?.runs[0];
      const liStyle = this.generateInlineStyle(firstRun, fontMappings);
      for (const t of block.listItemTexts) {
        const safe = this.escapeHtml(String(t || ''));
        if (safe.trim().length > 0) items.push(`  <li style="${liStyle}">${safe}</li>`);
      }
    } else if (Array.isArray(block.listItems) && block.listItems.length > 0) {
      for (const group of block.listItems) {
        const firstRun = this.findFirstNonEmptyRun(group[0]);
        const liStyle = this.generateInlineStyle(firstRun ?? group[0]?.runs[0], fontMappings);
        const html = group
          .map((l) => this.renderLineContent(l, fontMappings))
          .join(' ')
          .trim();
        if (html.length > 0) items.push(`  <li style="${liStyle}">${html}</li>`);
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
          const fs = line.runs[0]?.fontSize ?? 12;
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

    const firstRun = block.lines[0].runs[0];
    const listStyle = firstRun
      ? `font-family: ${this.getCssFontStack(firstRun.fontFamily, fontMappings)}; font-size: ${firstRun.fontSize}px`
      : '';

    return `<${listTag} style="${listStyle}">\n${items.join('\n')}\n</${listTag}>`;
  }

  private renderLineContent(line: Line, fontMappings: FontMapping[]): string {
    if (line.runs.length === 1) {
      return this.escapeHtml(line.runs[0].text);
    }

    return line.runs
      .map((r) => {
        const style = this.generateInlineStyle(r, fontMappings);
        return `<span style="${style}">${this.escapeHtml(r.text)}</span>`;
      })
      .join('');
  }

  private generateInlineStyle(run: TextRun | undefined, fontMappings: FontMapping[]): string {
    if (!run) return '';

    const parts: string[] = [];
    parts.push(`font-family: ${this.getCssFontStack(run.fontFamily, fontMappings)}`);
    parts.push(`font-size: ${run.fontSize}px`);

    if (run.fontWeight && run.fontWeight !== 400) parts.push(`font-weight: ${run.fontWeight}`);
    if (run.fontStyle && run.fontStyle !== 'normal') parts.push(`font-style: ${run.fontStyle}`);
    if (run.color && run.color !== 'rgba(0, 0, 0, 1)') parts.push(`color: ${run.color}`);

    return parts.join('; ');
  }

  private getCssFontStack(rawFamily: string, fontMappings: FontMapping[]): string {
    const key = normalizeFontName(rawFamily || '').family;
    const mapping = fontMappings.find((m) => {
      const famKey = normalizeFontName(m.detectedFont.family || '').family;
      const nameKey = normalizeFontName(m.detectedFont.name || '').family;
      return (key && famKey === key) || (key && nameKey === key) || m.detectedFont.family === rawFamily;
    });
    if (mapping) {
      const family = mapping.googleFont.family;
      const quoted = family.includes(' ') ? `'${family}'` : family;
      const seenKey = `map:${rawFamily}=>${family}`;
      if (this.debugEnabled() && !this.debugFontSeen.has(seenKey)) {
        this.debugFontSeen.add(seenKey);
        this.debug('fontStack', { rawFamily, normalized: key, mappedTo: family, fallbackChain: mapping.fallbackChain });
      }
      return `${quoted}, ${mapping.fallbackChain.join(', ')}`;
    }

    const resolver = getDefaultFontMetricsResolver();
    const match = resolver.resolveByName(rawFamily || '');
    const family = match.record.family;
    const quoted = family.includes(' ') ? `'${family}'` : family;

    const seenKey = `fallback:${rawFamily}=>${family}`;
    if (this.debugEnabled() && !this.debugFontSeen.has(seenKey)) {
      this.debugFontSeen.add(seenKey);
      this.debug('fontStack', { rawFamily, normalized: key, resolved: family, reason: match.reason, score: match.score });
    }

    if (match.record.category === 'serif') {
      return `${quoted}, 'Times New Roman', Times, serif`;
    }

    if (match.record.category === 'monospace') {
      return `${quoted}, 'Courier New', Courier, monospace`;
    }

    return `${quoted}, Arial, Helvetica, sans-serif`;
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

  private findFirstNonEmptyRun(line: Line | undefined): TextRun | undefined {
    if (!line) return undefined;
    return line.runs.find((r) => r.text.trim().length > 0);
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
