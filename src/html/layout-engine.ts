import type { PDFTextContent, PDFImageContent } from '../types/pdf.js';
import type { HTMLGenerationOptions } from '../types/output.js';
import { TextProcessor, type ProcessedTextContent } from '../core/text-processor.js';

export class LayoutEngine {
  private options: HTMLGenerationOptions;
  private textProcessor: TextProcessor;

  constructor(options: HTMLGenerationOptions) {
    this.options = options;
    this.textProcessor = new TextProcessor();
  }

  transformCoordinates(
    x: number,
    y: number,
    pageHeight: number
  ): { x: number; y: number } {
    // PDF coordinates: origin at bottom-left
    // HTML coordinates: origin at top-left
    return {
      x,
      y: pageHeight - y
    };
  }

  generateTextElement(
    text: PDFTextContent,
    pageHeight: number,
    fontClass: string
  ): string {
    const processed = this.textProcessor.processTextContent([text])[0];
    return this.generateProcessedTextElement(processed, pageHeight, fontClass);
  }

  private generateProcessedTextElement(
    text: ProcessedTextContent,
    pageHeight: number,
    fontClass: string
  ): string {
    const coords = this.transformCoordinates(text.x, text.y, pageHeight);

    // Build style attributes
    const styleParts: string[] = [];
    
    if (this.options.preserveLayout) {
      styleParts.push(`position: absolute`);
      styleParts.push(`left: ${coords.x}px`);
      styleParts.push(`top: ${coords.y}px`);
      if (typeof text.rotation === 'number' && Math.abs(text.rotation) > 0.01) {
        styleParts.push(`transform: rotate(${text.rotation}deg)`);
        styleParts.push(`transform-origin: left top`);
      }
    }
    
    styleParts.push(`font-size: ${text.fontSize}px`);
    styleParts.push(`color: ${text.color}`);
    
    if (text.fontWeight && text.fontWeight !== 400) {
      styleParts.push(`font-weight: ${text.fontWeight}`);
    }
    
    if (text.fontStyle && text.fontStyle !== 'normal') {
      styleParts.push(`font-style: ${text.fontStyle}`);
    }
    
    if (text.textDecoration && text.textDecoration !== 'none') {
      styleParts.push(`text-decoration: ${text.textDecoration}`);
    }

    const style = styleParts.join('; ');

    // Determine HTML tag based on semantic analysis
    const tag = text.semanticTag || 'span';
    
    // Build HTML attributes
    const attrs: string[] = [];
    if (fontClass) {
      attrs.push(`class="${fontClass}"`);
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

  generateImageElement(
    image: PDFImageContent,
    pageHeight: number,
    baseUrl?: string
  ): string {
    const coords = this.transformCoordinates(image.x, image.y, pageHeight);

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
      ? `position: absolute; left: ${coords.x}px; top: ${coords.y}px; width: ${image.width}px; height: ${image.height}px;`
      : `width: ${image.width}px; height: ${image.height}px; max-width: 100%;`;

    return `<img src="${this.escapeHtml(src)}" alt="" style="${style}" />`;
  }

  detectTable(textContents: PDFTextContent[]): TableStructure | null {
    if (textContents.length < 4) {
      return null; // Need at least a few cells
    }

    // Group text items by Y position (rows)
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
      return null; // Need at least 2 rows
    }

    // Check if items align into columns
    const columnCount = Math.max(...rows.map((r) => r.length));
    if (columnCount < 2) {
      return null; // Need at least 2 columns
    }

    // Verify alignment - check if items in same column have similar X positions
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

    // Check if columns are reasonably aligned
    const alignmentScore = columnXPositions.reduce((score, positions) => {
      if (positions.length < 2) return score;
      const avgX = positions.reduce((a, b) => a + b, 0) / positions.length;
      const variance = positions.reduce((sum, x) => sum + Math.pow(x - avgX, 2), 0) / positions.length;
      return score + (1 / (1 + variance)); // Lower variance = better alignment
    }, 0) / columnXPositions.length;

    if (alignmentScore < 0.5) {
      return null; // Poor alignment, probably not a table
    }

    // Build table structure
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

    // Group text by Y position to find lines
    const lines = new Map<number, PDFTextContent[]>();
    for (const text of textContents) {
      const y = Math.round(text.y);
      if (!lines.has(y)) {
        lines.set(y, []);
      }
      lines.get(y)!.push(text);
    }

    // Find X positions that might indicate column boundaries
    const xPositions = new Set<number>();
    for (const text of textContents) {
      xPositions.add(Math.round(text.x));
      xPositions.add(Math.round(text.x + text.width));
    }

    const sortedX = Array.from(xPositions).sort((a, b) => a - b);

    // Look for gaps that might indicate columns
    const gaps: Array<{ start: number; end: number; width: number }> = [];
    for (let i = 0; i < sortedX.length - 1; i++) {
      const gap = sortedX[i + 1] - sortedX[i];
      if (gap > 50) {
        // Significant gap, might be column boundary
        gaps.push({
          start: sortedX[i],
          end: sortedX[i + 1],
          width: gap
        });
      }
    }

    if (gaps.length === 0) {
      return null; // No clear column separation
    }

    // Determine column boundaries
    const columnBoundaries = [0, ...gaps.map((g) => g.end), Infinity];
    const columns: Column[] = [];

    for (let i = 0; i < columnBoundaries.length - 1; i++) {
      const x = columnBoundaries[i];
      const width = columnBoundaries[i + 1] === Infinity
        ? 1000 // Estimate
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

