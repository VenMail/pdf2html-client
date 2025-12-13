import type { PDFTextContent } from '../types/pdf.js';

export interface LayoutAnalysis {
  readingOrder: ReadingOrder;
  structures: DocumentStructure[];
  spatialGroups: SpatialGroup[];
}

export interface ReadingOrder {
  direction: 'ltr' | 'rtl' | 'ttb';
  columns: Column[];
}

export interface Column {
  x: number;
  width: number;
  content: PDFTextContent[];
}

export interface DocumentStructure {
  type: 'header' | 'paragraph' | 'list' | 'table' | 'section';
  items: PDFTextContent[];
  level?: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface SpatialGroup {
  items: PDFTextContent[];
  bounds: { x: number; y: number; width: number; height: number };
  relationship: 'line' | 'paragraph' | 'block';
}

export class LayoutAnalyzer {
  analyze(textContents: PDFTextContent[]): LayoutAnalysis {
    if (textContents.length === 0) {
      return {
        readingOrder: { direction: 'ltr', columns: [] },
        structures: [],
        spatialGroups: []
      };
    }

    const readingOrder = this.detectReadingOrder(textContents);
    const structures = this.detectStructures(textContents);
    const spatialGroups = this.groupSpatially(textContents);

    return {
      readingOrder,
      structures,
      spatialGroups
    };
  }

  private detectReadingOrder(textContents: PDFTextContent[]): ReadingOrder {
    if (textContents.length === 0) {
      return { direction: 'ltr', columns: [] };
    }

    const direction = this.detectTextDirection(textContents);
    const columns = this.detectColumns(textContents);

    return {
      direction,
      columns
    };
  }

  private detectTextDirection(textContents: PDFTextContent[]): 'ltr' | 'rtl' | 'ttb' {
    if (textContents.length === 0) return 'ltr';

    const rtlChars = /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
    const hasRTL = textContents.some(item => rtlChars.test(item.text));

    if (hasRTL) {
      return 'rtl';
    }

    const avgXMovement = this.calculateAverageXMovement(textContents);
    if (avgXMovement < 0) {
      return 'rtl';
    }

    return 'ltr';
  }

  private calculateAverageXMovement(textContents: PDFTextContent[]): number {
    if (textContents.length < 2) return 0;

    const sorted = [...textContents].sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 5) return yDiff;
      return a.x - b.x;
    });

    let totalMovement = 0;
    let count = 0;

    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1];
      const curr = sorted[i];
      const yDiff = Math.abs(curr.y - prev.y);

      if (yDiff < 5) {
        totalMovement += curr.x - prev.x;
        count++;
      }
    }

    return count > 0 ? totalMovement / count : 0;
  }

  private detectColumns(textContents: PDFTextContent[]): Column[] {
    if (textContents.length === 0) return [];

    const pageWidth = Math.max(...textContents.map(t => t.x + t.width));
    const gapThreshold = pageWidth * 0.1;

    const xPositions = new Set<number>();
    for (const text of textContents) {
      xPositions.add(Math.round(text.x));
      xPositions.add(Math.round(text.x + text.width));
    }

    const sortedX = Array.from(xPositions).sort((a, b) => a - b);
    const gaps: Array<{ start: number; end: number; width: number }> = [];

    for (let i = 0; i < sortedX.length - 1; i++) {
      const gap = sortedX[i + 1] - sortedX[i];
      if (gap > gapThreshold) {
        gaps.push({
          start: sortedX[i],
          end: sortedX[i + 1],
          width: gap
        });
      }
    }

    if (gaps.length === 0) {
      return [{
        x: 0,
        width: pageWidth,
        content: textContents
      }];
    }

    const columnBoundaries = [0, ...gaps.map(g => g.end), pageWidth];
    const columns: Column[] = [];

    for (let i = 0; i < columnBoundaries.length - 1; i++) {
      const x = columnBoundaries[i];
      const width = columnBoundaries[i + 1] - x;
      const content = textContents.filter(
        t => t.x >= x && t.x < columnBoundaries[i + 1]
      );

      if (content.length > 0) {
        columns.push({ x, width, content });
      }
    }

    return columns;
  }

  private detectStructures(textContents: PDFTextContent[]): DocumentStructure[] {
    const structures: DocumentStructure[] = [];

    const avgFontSize = textContents.reduce((sum, t) => sum + t.fontSize, 0) / textContents.length;
    const lines = this.groupIntoLines(textContents);

    for (const line of lines) {
      const lineFontSize = line.items.reduce((sum, t) => sum + t.fontSize, 0) / line.items.length;
      const ratio = lineFontSize / avgFontSize;

      if (ratio >= 1.5) {
        const level = ratio >= 2.0 ? 1 : ratio >= 1.75 ? 2 : 3;
        structures.push({
          type: 'header',
          items: line.items,
          level,
          bounds: this.calculateBounds(line.items)
        });
      } else if (this.isList(line.items)) {
        structures.push({
          type: 'list',
          items: line.items,
          bounds: this.calculateBounds(line.items)
        });
      } else {
        const paragraph = this.findParagraph(line, lines);
        if (paragraph.length > 0) {
          structures.push({
            type: 'paragraph',
            items: paragraph,
            bounds: this.calculateBounds(paragraph)
          });
        }
      }
    }

    const tables = this.detectTables(textContents);
    structures.push(...tables);

    return structures;
  }

  private groupIntoLines(textContents: PDFTextContent[]): Array<{ items: PDFTextContent[]; y: number }> {
    const lines = new Map<number, PDFTextContent[]>();
    const tolerance = 3;

    for (const text of textContents) {
      const y = Math.round(text.y);
      let found = false;

      for (const [lineY, items] of lines.entries()) {
        if (Math.abs(lineY - y) < tolerance) {
          items.push(text);
          found = true;
          break;
        }
      }

      if (!found) {
        lines.set(y, [text]);
      }
    }

    return Array.from(lines.entries())
      .map(([y, items]) => ({
        items: items.sort((a, b) => a.x - b.x),
        y
      }))
      .sort((a, b) => b.y - a.y);
  }

  private isList(items: PDFTextContent[]): boolean {
    if (items.length === 0) return false;

    const firstText = items[0].text.trim();
    const listPatterns = [
      /^[-•·]\s/,
      /^\d+[.)]\s/,
      /^[a-z][.)]\s/,
      /^[ivx]+[.)]\s/i
    ];

    return listPatterns.some(pattern => pattern.test(firstText));
  }

  private findParagraph(
    line: { items: PDFTextContent[]; y: number },
    allLines: Array<{ items: PDFTextContent[]; y: number }>
  ): PDFTextContent[] {
    const paragraph: PDFTextContent[] = [...line.items];
    const lineHeight = line.items[0]?.height || 12;
    const paragraphGap = lineHeight * 1.5;

    let currentY = line.y;
    let foundMore = true;

    while (foundMore) {
      foundMore = false;
      const nextY = currentY - paragraphGap;
      const tolerance = lineHeight * 0.5;

      for (const otherLine of allLines) {
        if (Math.abs(otherLine.y - nextY) < tolerance) {
          paragraph.push(...otherLine.items);
          currentY = otherLine.y;
          foundMore = true;
          break;
        }
      }
    }

    return paragraph;
  }

  private detectTables(textContents: PDFTextContent[]): DocumentStructure[] {
    const tables: DocumentStructure[] = [];
    const lines = this.groupIntoLines(textContents);

    if (lines.length < 2) return tables;

    const potentialTableRows: PDFTextContent[][] = [];
    const columnCounts = new Map<number, number>();

    for (const line of lines) {
      if (line.items.length >= 2) {
        potentialTableRows.push(line.items);
        columnCounts.set(line.items.length, (columnCounts.get(line.items.length) || 0) + 1);
      }
    }

    const mostCommonColumnCount = Array.from(columnCounts.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0];

    if (!mostCommonColumnCount || mostCommonColumnCount < 2) return tables;

    const tableRows = potentialTableRows.filter(row => row.length === mostCommonColumnCount);

    if (tableRows.length >= 2) {
      const allTableItems = tableRows.flat();
      const alignmentScore = this.calculateTableAlignment(tableRows);

      if (alignmentScore > 0.5) {
        tables.push({
          type: 'table',
          items: allTableItems,
          bounds: this.calculateBounds(allTableItems)
        });
      }
    }

    return tables;
  }

  private calculateTableAlignment(rows: PDFTextContent[][]): number {
    if (rows.length < 2) return 0;

    const columnCount = rows[0].length;
    let totalScore = 0;

    for (let col = 0; col < columnCount; col++) {
      const xPositions: number[] = [];
      for (const row of rows) {
        if (row[col]) {
          xPositions.push(row[col].x);
        }
      }

      if (xPositions.length < 2) continue;

      const avgX = xPositions.reduce((a, b) => a + b, 0) / xPositions.length;
      const variance = xPositions.reduce((sum, x) => sum + Math.pow(x - avgX, 2), 0) / xPositions.length;
      const score = 1 / (1 + variance);
      totalScore += score;
    }

    return totalScore / columnCount;
  }

  private groupSpatially(textContents: PDFTextContent[]): SpatialGroup[] {
    const groups: SpatialGroup[] = [];
    const processed = new Set<PDFTextContent>();

    for (const text of textContents) {
      if (processed.has(text)) continue;

      const group = this.findSpatialGroup(text, textContents, processed);
      if (group.length > 0) {
        groups.push({
          items: group,
          bounds: this.calculateBounds(group),
          relationship: this.determineRelationship(group)
        });
        group.forEach(item => processed.add(item));
      }
    }

    return groups;
  }

  private findSpatialGroup(
    start: PDFTextContent,
    allText: PDFTextContent[],
    processed: Set<PDFTextContent>
  ): PDFTextContent[] {
    const group: PDFTextContent[] = [start];
    const proximityThreshold = Math.max(start.width, start.height) * 2;

    let foundMore = true;
    while (foundMore) {
      foundMore = false;
      for (const text of allText) {
        if (processed.has(text) || group.includes(text)) continue;

        for (const groupItem of group) {
          const distance = this.calculateDistance(text, groupItem);
          if (distance < proximityThreshold) {
            group.push(text);
            foundMore = true;
            break;
          }
        }
      }
    }

    return group;
  }

  private calculateDistance(a: PDFTextContent, b: PDFTextContent): number {
    const centerAX = a.x + a.width / 2;
    const centerAY = a.y + a.height / 2;
    const centerBX = b.x + b.width / 2;
    const centerBY = b.y + b.height / 2;

    return Math.hypot(centerBX - centerAX, centerBY - centerAY);
  }

  private determineRelationship(items: PDFTextContent[]): 'line' | 'paragraph' | 'block' {
    if (items.length === 1) return 'line';

    const yPositions = new Set(items.map(i => Math.round(i.y)));
    if (yPositions.size === 1) return 'line';

    const avgYSpacing = this.calculateAverageYSpacing(items);
    const lineHeight = items[0]?.height || 12;
    const paragraphThreshold = lineHeight * 1.5;

    if (avgYSpacing < paragraphThreshold) {
      return 'paragraph';
    }

    return 'block';
  }

  private calculateAverageYSpacing(items: PDFTextContent[]): number {
    if (items.length < 2) return 0;

    const sorted = [...items].sort((a, b) => b.y - a.y);
    let totalSpacing = 0;
    let count = 0;

    for (let i = 1; i < sorted.length; i++) {
      const spacing = sorted[i - 1].y - sorted[i].y;
      if (spacing > 0) {
        totalSpacing += spacing;
        count++;
      }
    }

    return count > 0 ? totalSpacing / count : 0;
  }

  private calculateBounds(items: PDFTextContent[]): { x: number; y: number; width: number; height: number } {
    if (items.length === 0) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const minX = Math.min(...items.map(i => i.x));
    const maxX = Math.max(...items.map(i => i.x + i.width));
    const minY = Math.min(...items.map(i => i.y));
    const maxY = Math.max(...items.map(i => i.y + i.height));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };
  }
}

