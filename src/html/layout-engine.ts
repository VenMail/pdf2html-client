import type { PDFTextContent, PDFImageContent } from '../types/pdf.js';
import type { HTMLGenerationOptions } from '../types/output.js';
import { TextProcessor, type ProcessedTextContent } from '../core/text-processor.js';
import { LayoutAnalyzer } from '../core/layout-analyzer.js';
import { getDefaultFontMetricsResolver } from '../fonts/font-metrics-resolver.js';

export class LayoutEngine {
  private options: HTMLGenerationOptions;
  private textProcessor: TextProcessor;
  private layoutAnalyzer: LayoutAnalyzer;
  private absVisualStyleClassByKey: Map<string, string> = new Map();
  private extraCssRules: string[] = [];

  constructor(options: HTMLGenerationOptions) {
    this.options = options;
    this.textProcessor = new TextProcessor();
    this.layoutAnalyzer = new LayoutAnalyzer();
  }

  private getCssFontStack(rawFamily: string): string {
    const resolver = getDefaultFontMetricsResolver();
    const match = resolver.resolveByName(rawFamily || '');
    const family = match.record.family;
    const quoted = family.includes(' ') ? `'${family}'` : family;

    if (match.record.category === 'serif') {
      return `${quoted}, 'Times New Roman', Times, serif`;
    }

    if (match.record.category === 'monospace') {
      return `${quoted}, 'Courier New', Courier, monospace`;
    }

    return `${quoted}, Arial, Helvetica, sans-serif`;
  }

  private getSvgFontStack(rawFamily: string): string {
    const raw = String(rawFamily || '').trim();
    if (!raw) return this.getCssFontStack('');

    const generic = raw.toLowerCase();
    const isGeneric =
      generic === 'serif' ||
      generic === 'sans-serif' ||
      generic === 'sans' ||
      generic === 'monospace' ||
      generic === 'cursive' ||
      generic === 'fantasy' ||
      generic === 'system-ui';

    if (isGeneric) return this.getCssFontStack(raw);

    const quotedRaw = raw.includes(' ') ? `'${raw}'` : raw;
    return `${quotedRaw}, ${this.getCssFontStack(raw)}`;
  }

  resetCssCaches(): void {
    this.absVisualStyleClassByKey.clear();
    this.extraCssRules = [];
  }

  getExtraCssRules(): string[] {
    return this.extraCssRules;
  }

  transformCoordinates(
    x: number,
    y: number,
    pageHeight: number,
    height: number = 0
  ): { x: number; y: number } {
    // PDF coordinates: origin at bottom-left
    // HTML coordinates: origin at top-left
    return {
      x,
      // PDF y is at the baseline (or bottom for images). Shift by element height so CSS top aligns to top-left.
      y: pageHeight - y - height
    };
  }

  generateTextElement(
    text: PDFTextContent,
    pageHeight: number,
    fontClass: string,
    options?: {
      coordsOverride?: { x: number; y: number };
    }
  ): string {
    const processed = this.textProcessor.processTextContent([text])[0];
    return this.generateProcessedTextElement(processed, pageHeight, fontClass, options);
  }

  generateSvgTextElement(
    text: PDFTextContent,
    pageHeight: number,
    fontClass: string
  ): string {
    const processed = this.textProcessor.processTextContent([text])[0];
    return this.generateProcessedSvgTextElement(processed, pageHeight, fontClass);
  }

  generateInlineTextSpan(text: PDFTextContent, fontClass: string): string {
    const processed = this.textProcessor.processTextContent([text])[0];

    const includeFontFamily = !fontClass || fontClass === 'font-default';
    const visualStyle: Record<string, string> = {
      'font-size': `${processed.fontSize}px`,
      color: processed.color
    };
    if (includeFontFamily) {
      visualStyle['font-family'] = this.getCssFontStack(processed.fontFamily);
    }

    if (processed.fontWeight && processed.fontWeight !== 400) {
      visualStyle['font-weight'] = String(processed.fontWeight);
    }

    if (processed.fontStyle && processed.fontStyle !== 'normal') {
      visualStyle['font-style'] = processed.fontStyle;
    }

    if (processed.textDecoration && processed.textDecoration !== 'none') {
      visualStyle['text-decoration'] = processed.textDecoration;
    }

    const visualClass = this.options.preserveLayout ? this.getAbsVisualStyleClass(visualStyle) : undefined;

    const attrs: string[] = [];
    const classes: string[] = [];
    if (fontClass) classes.push(fontClass);
    if (visualClass) classes.push(visualClass);
    if (classes.length > 0) {
      attrs.push(`class="${classes.join(' ')}"`);
    }

    if (processed.htmlAttributes) {
      for (const [key, value] of Object.entries(processed.htmlAttributes)) {
        attrs.push(`${key}="${this.escapeHtml(value)}"`);
      }
    }

    const attrsString = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    const inlineTag = processed.semanticTag === 'strong' || processed.semanticTag === 'em'
      ? processed.semanticTag
      : 'span';
    return `<${inlineTag}${attrsString}>${this.escapeHtml(processed.text)}</${inlineTag}>`;
  }

  private generateProcessedTextElement(
    text: ProcessedTextContent,
    pageHeight: number,
    fontClass: string,
    options?: {
      coordsOverride?: { x: number; y: number };
    }
  ): string {
    const coords = options?.coordsOverride ?? this.transformCoordinates(text.x, text.y, pageHeight, text.height);
    const absElementLineHeightFactor =
      typeof this.options.layoutTuning?.absElementLineHeightFactor === 'number'
        ? this.options.layoutTuning.absElementLineHeightFactor
        : 1.15;
    const lineHeightPx = Math.max(1, Math.round(Math.max(text.height, text.fontSize * absElementLineHeightFactor)));

    // Build style attributes
    const positionalStyleParts: string[] = [];
    const includeFontFamily = !fontClass || fontClass === 'font-default';
    const visualStyle: Record<string, string> = {
      'font-size': `${text.fontSize}px`,
      color: text.color
    };
    if (includeFontFamily) {
      visualStyle['font-family'] = this.getCssFontStack(text.fontFamily);
    }

    if (text.fontWeight && text.fontWeight !== 400) {
      visualStyle['font-weight'] = String(text.fontWeight);
    }

    if (text.fontStyle && text.fontStyle !== 'normal') {
      visualStyle['font-style'] = text.fontStyle;
    }

    if (text.textDecoration && text.textDecoration !== 'none') {
      visualStyle['text-decoration'] = text.textDecoration;
    }

    let visualClass: string | undefined;

    if (this.options.preserveLayout) {
      positionalStyleParts.push(`position: absolute`);
      positionalStyleParts.push(`left: ${coords.x}px`);
      positionalStyleParts.push(`top: ${coords.y}px`);
      positionalStyleParts.push(`line-height: ${lineHeightPx}px`);
      if (typeof text.rotation === 'number' && Math.abs(text.rotation) > 0.01) {
        positionalStyleParts.push(`transform: rotate(${text.rotation}deg)`);
        positionalStyleParts.push(`transform-origin: left top`);
      }
      visualClass = this.getAbsVisualStyleClass(visualStyle);
    } else {
      // Non-layout-preserving output still uses inline styles.
      for (const [k, v] of Object.entries(visualStyle)) {
        positionalStyleParts.push(`${k}: ${v}`);
      }
    }

    const style = positionalStyleParts.join('; ');

    const tag = this.options.preserveLayout
      ? text.semanticTag === 'strong' || text.semanticTag === 'em'
        ? text.semanticTag
        : 'span'
      : text.semanticTag || 'span';
    
    // Build HTML attributes
    const attrs: string[] = [];
    const classes: string[] = [];
    if (fontClass) classes.push(fontClass);
    if (visualClass) classes.push(visualClass);
    if (classes.length > 0) {
      attrs.push(`class="${classes.join(' ')}"`);
    }
    attrs.push(`style="${style}"`);
    
    if (text.htmlAttributes) {
      for (const [key, value] of Object.entries(text.htmlAttributes)) {
        attrs.push(`${key}="${this.escapeHtml(value)}"`);
      }
    }

    const attrsString = attrs.length > 0 ? ' ' + attrs.join(' ') : '';

    return `<${tag}${attrsString}>${this.escapeHtml(text.text)}</${tag}>`;
  }

  private getAbsVisualStyleClass(style: Record<string, string>): string {
    const entries = Object.entries(style)
      .filter(([, v]) => typeof v === 'string' && v.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));
    const key = entries.map(([k, v]) => `${k}:${v}`).join(';');

    const existing = this.absVisualStyleClassByKey.get(key);
    if (existing) return existing;

    const className = `pdf-abs-style-${this.absVisualStyleClassByKey.size}`;
    this.absVisualStyleClassByKey.set(key, className);
    const decls = entries.map(([k, v]) => `  ${k}: ${v};`).join('\n');
    this.extraCssRules.push(`.${className} {\n${decls}\n}`);
    return className;
  }

  getProcessedTextContent(text: PDFTextContent): ProcessedTextContent {
    return this.textProcessor.processTextContent([text])[0];
  }

  shouldUseSvgText(text: ProcessedTextContent): boolean {
    // Don't use SVG text for very short text (can cause stretching issues)
    if (!text.text || text.text.trim().length < 2) {
      return false;
    }
    
    // Don't use SVG text if width seems unreasonable compared to text content
    if (text.width && text.width > 0) {
      const estimatedWidth = text.text.length * text.fontSize * 0.6; // Rough estimate
      const ratio = text.width / estimatedWidth;
      // If width is more than 3x the estimated width, SVG text will stretch badly
      if (ratio > 3 || ratio < 0.3) {
        return false;
      }
    }
    
    // Don't use SVG text for very large font sizes (stretching becomes more noticeable)
    if (text.fontSize && text.fontSize > 72) {
      return false;
    }
    
    return true;
  }

  private generateProcessedSvgTextElement(
    text: ProcessedTextContent,
    pageHeight: number,
    fontClass: string
  ): string {
    const x = text.x;
    const y = pageHeight - text.y;

    const attrs: string[] = [];
    if (fontClass) {
      attrs.push(`class="${fontClass}"`);
    }

    attrs.push(`x="${x}"`);
    attrs.push(`y="${y}"`);
    attrs.push('text-anchor="start"');
    attrs.push('xml:space="preserve"');
    attrs.push(`textLength="${Math.max(0, text.width)}"`);
    attrs.push('lengthAdjust="spacing"');

    if (typeof text.rotation === 'number' && Math.abs(text.rotation) > 0.01) {
      attrs.push(`transform="rotate(${text.rotation} ${x} ${y})"`);
    }

    const styleParts: string[] = [];
    styleParts.push(`font-size: ${text.fontSize}px`);
    styleParts.push(`fill: ${text.color}`);
    if (!fontClass || fontClass === 'font-default') {
      styleParts.push(`font-family: ${this.getSvgFontStack(text.fontFamily)}`);
    }
    if (text.fontWeight && text.fontWeight !== 400) styleParts.push(`font-weight: ${text.fontWeight}`);
    if (text.fontStyle && text.fontStyle !== 'normal') styleParts.push(`font-style: ${text.fontStyle}`);
    if (text.textDecoration && text.textDecoration !== 'none') styleParts.push(`text-decoration: ${text.textDecoration}`);

    if (styleParts.length > 0) {
      attrs.push(`style="${styleParts.join('; ')}"`);
    }

    return `<text ${attrs.join(' ')}>${this.escapeHtml(text.text)}</text>`;
  }

  generateImageElement(
    image: PDFImageContent,
    pageHeight: number,
    baseUrl?: string
  ): string {
    const coords = this.transformCoordinates(image.x, image.y, pageHeight, image.height);

    let src: string;
    if (typeof image.data === 'string') {
      // Already a string (base64 or data URL)
      src = image.data.startsWith('data:') 
        ? image.data 
        : `data:image/${image.format};base64,${image.data}`;
    } else if (image.data instanceof ArrayBuffer) {
      // Convert ArrayBuffer to base64
      const bytes = new Uint8Array(image.data);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      src = `data:image/${image.format};base64,${base64}`;
    } else if (baseUrl) {
      src = `${baseUrl}/${image.format}`;
    } else {
      src = '#';
    }

    const style = this.options.preserveLayout
      ? (() => {
          const parts: string[] = [];
          parts.push('position: absolute');
          parts.push(`left: ${coords.x}px`);
          parts.push(`top: ${coords.y}px`);
          parts.push(`width: ${image.width}px`);
          parts.push(`height: ${image.height}px`);
          if (typeof image.rotation === 'number' && Math.abs(image.rotation) > 0.01) {
            parts.push(`transform: rotate(${image.rotation}deg)`);
            parts.push('transform-origin: left top');
          }
          return parts.join('; ');
        })()
      : `width: ${image.width}px; height: ${image.height}px; max-width: 100%;`;

    return `<img src="${this.escapeHtml(src)}" alt="" style="${style}" />`;
  }

  detectTable(textContents: PDFTextContent[]): TableStructure | null {
    // Use LayoutAnalyzer for better table detection
    const analysis = this.layoutAnalyzer.analyze(textContents);
    const tableStructure = analysis.structures.find(s => s.type === 'table');
    
    if (tableStructure) {
      const lines = this.groupIntoLinesForTable(tableStructure.items);
      const tableRows: TableRow[] = lines.map((row) => ({
        cells: row.map((item) => ({
          text: item.text,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height
        }))
      }));

      return {
        rows: tableRows,
        columnCount: Math.max(...tableRows.map(r => r.cells.length), 0)
      };
    }

    // Fallback to original detection method
    if (textContents.length < 4) {
      return null;
    }

    const yPositions = new Set(textContents.map((t) => Math.round(t.y)));
    const rows: PDFTextContent[][] = [];

    for (const y of Array.from(yPositions).sort((a, b) => b - a)) {
      const rowItems = textContents.filter(
        (t) => Math.abs(Math.round(t.y) - y) < 5
      );
      if (rowItems.length > 0) {
        rows.push(rowItems.sort((a, b) => a.x - b.x));
      }
    }

    if (rows.length < 2) {
      return null;
    }

    const columnCount = Math.max(...rows.map((r) => r.length));
    if (columnCount < 2) {
      return null;
    }

    const columnXPositions: number[][] = [];
    for (let col = 0; col < columnCount; col++) {
      const xPositions: number[] = [];
      for (const row of rows) {
        if (row[col]) {
          xPositions.push(row[col].x);
        }
      }
      if (xPositions.length > 0) {
        columnXPositions.push(xPositions);
      }
    }

    const alignmentScore = columnXPositions.reduce((score, positions) => {
      if (positions.length < 2) return score;
      const avgX = positions.reduce((a, b) => a + b, 0) / positions.length;
      const variance = positions.reduce((sum, x) => sum + Math.pow(x - avgX, 2), 0) / positions.length;
      return score + (1 / (1 + variance));
    }, 0) / columnXPositions.length;

    if (alignmentScore < 0.5) {
      return null;
    }

    const tableRows: TableRow[] = rows.map((row) => ({
      cells: row.map((item) => ({
        text: item.text,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height
      }))
    }));

    return {
      rows: tableRows,
      columnCount
    };
  }

  private groupIntoLinesForTable(items: PDFTextContent[]): PDFTextContent[][] {
    const lines = new Map<number, PDFTextContent[]>();
    const tolerance = 3;

    for (const item of items) {
      const y = Math.round(item.y);
      let found = false;

      for (const [lineY, lineItems] of lines.entries()) {
        if (Math.abs(lineY - y) < tolerance) {
          lineItems.push(item);
          found = true;
          break;
        }
      }

      if (!found) {
        lines.set(y, [item]);
      }
    }

    return Array.from(lines.values())
      .map(line => line.sort((a, b) => a.x - b.x))
      .sort((a, b) => b[0].y - a[0].y);
  }

  generateTableHTML(table: TableStructure): string {
    const parts: string[] = [];
    parts.push('<table style="border-collapse: collapse; width: 100%;">');

    for (const row of table.rows) {
      parts.push('<tr>');
      for (const cell of row.cells) {
        parts.push(
          `<td style="border: 1px solid #ddd; padding: 8px;">${this.escapeHtml(cell.text)}</td>`
        );
      }
      parts.push('</tr>');
    }

    parts.push('</table>');
    return parts.join('\n');
  }

  detectColumns(textContents: PDFTextContent[]): ColumnLayout | null {
    if (textContents.length === 0) {
      return null;
    }

    // Use LayoutAnalyzer for better column detection
    const analysis = this.layoutAnalyzer.analyze(textContents);
    if (analysis.readingOrder.columns.length >= 2) {
      return {
        columns: analysis.readingOrder.columns.map(col => ({
          x: col.x,
          width: col.width,
          content: col.content
        })),
        columnCount: analysis.readingOrder.columns.length
      };
    }

    // Fallback to original detection method
    const lines = new Map<number, PDFTextContent[]>();
    for (const text of textContents) {
      const y = Math.round(text.y);
      if (!lines.has(y)) {
        lines.set(y, []);
      }
      lines.get(y)!.push(text);
    }

    const xPositions = new Set<number>();
    for (const text of textContents) {
      xPositions.add(Math.round(text.x));
      xPositions.add(Math.round(text.x + text.width));
    }

    const sortedX = Array.from(xPositions).sort((a, b) => a - b);

    const gaps: Array<{ start: number; end: number; width: number }> = [];
    for (let i = 0; i < sortedX.length - 1; i++) {
      const gap = sortedX[i + 1] - sortedX[i];
      if (gap > 50) {
        gaps.push({
          start: sortedX[i],
          end: sortedX[i + 1],
          width: gap
        });
      }
    }

    if (gaps.length === 0) {
      return null;
    }

    const columnBoundaries = [0, ...gaps.map((g) => g.end), Infinity];
    const columns: Column[] = [];

    for (let i = 0; i < columnBoundaries.length - 1; i++) {
      const x = columnBoundaries[i];
      const width = columnBoundaries[i + 1] === Infinity
        ? 1000
        : columnBoundaries[i + 1] - x;

      const content = textContents.filter(
        (t) => t.x >= x && t.x < columnBoundaries[i + 1]
      );

      if (content.length > 0) {
        columns.push({ x, width, content });
      }
    }

    if (columns.length < 2) {
      return null;
    }

    return {
      columns,
      columnCount: columns.length
    };
  }

  generateColumnHTML(columns: ColumnLayout): string {
    const parts: string[] = [];
    parts.push('<div style="display: flex; gap: 20px;">');

    for (const column of columns.columns) {
      parts.push(`<div style="flex: 1; min-width: 0;">`);
      for (const text of column.content) {
        parts.push(
          `<p style="margin: 0 0 8px 0;">${this.escapeHtml(text.text)}</p>`
        );
      }
      parts.push('</div>');
    }

    parts.push('</div>');
    return parts.join('\n');
  }

  private escapeHtml(text: string): string {
    // Use DOM API if available (browser), otherwise use string replacement (Node.js)
    if (typeof document !== 'undefined') {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
    // Node.js fallback
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}

export interface TableStructure {
  rows: TableRow[];
  columnCount: number;
}

export interface TableRow {
  cells: TableCell[];
}

export interface TableCell {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColumnLayout {
  columns: Column[];
  columnCount: number;
}

export interface Column {
  x: number;
  width: number;
  content: PDFTextContent[];
}

