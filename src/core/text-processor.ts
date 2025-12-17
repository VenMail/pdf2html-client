import type { PDFTextContent } from '../types/pdf.js';

export interface ProcessedTextContent extends Omit<PDFTextContent, 'fontWeight'> {
  semanticTag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span' | 'strong' | 'em' | 'li';
  htmlAttributes?: Record<string, string>;
  fontWeight: number;
  textDecoration?: 'none' | 'underline' | 'line-through' | 'overline';
}

export class TextProcessor {
  /**
   * Processes raw PDF text content and enhances it with better HTML mapping
   * Extracts font weight, style, color, and semantic meaning from PDF binary data
   */
  processTextContent(textItems: PDFTextContent[]): ProcessedTextContent[] {
    return textItems.map(item => this.enhanceTextItem(item, textItems));
  }

  private enhanceTextItem(
    item: PDFTextContent,
    allItems: PDFTextContent[]
  ): ProcessedTextContent {
    // Use format information from SmartTextExtractor (already set on item)
    const enhanced: ProcessedTextContent = { 
      ...item,
      fontWeight: item.fontWeight || 400
    };

    // Use font style from SmartTextExtractor
    if (item.fontStyle === 'italic' || item.fontStyle === 'oblique') {
      enhanced.semanticTag = 'em';
    }

    // Detect bold text using fontWeight from SmartTextExtractor
    if (enhanced.fontWeight && enhanced.fontWeight >= 600) {
      enhanced.semanticTag = enhanced.semanticTag === 'em' ? 'em' : 'strong';
    }

    // Detect headings based on font size relative to other text
    const fontSize = this.detectHeadingLevel(item, allItems);
    if (fontSize) {
      enhanced.semanticTag = fontSize;
    }

    // Extract color from PDF binary data (if available in fontInfo)
    if (item.color && item.color !== '#000000') {
      enhanced.htmlAttributes = {
        ...enhanced.htmlAttributes,
        'data-color': item.color
      };
    }

    // Detect text decoration from font characteristics
    enhanced.textDecoration = this.detectTextDecoration(item);

    // Build HTML attributes
    enhanced.htmlAttributes = {
      ...enhanced.htmlAttributes,
      'data-font-family': item.fontFamily,
      'data-font-size': `${item.fontSize}px`,
      'data-x': `${item.x}`,
      'data-y': `${item.y}`
    };

    return enhanced;
  }

  private detectHeadingLevel(
    item: PDFTextContent,
    allItems: PDFTextContent[]
  ): 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | undefined {
    if (allItems.length === 0) return undefined;

    // Calculate average font size
    const avgFontSize = allItems.reduce((sum, i) => sum + i.fontSize, 0) / allItems.length;

    // Check if this item is significantly larger (likely a heading)
    const ratio = item.fontSize / avgFontSize;

    if (ratio >= 2.0) return 'h1';
    if (ratio >= 1.75) return 'h2';
    if (ratio >= 1.5) return 'h3';
    if (ratio >= 1.25) return 'h4';
    if (ratio >= 1.1) return 'h5';
    if (ratio >= 1.05) return 'h6';

    // Also check if text is short and on its own line (heading indicator)
    if (item.text.trim().length < 100 && ratio >= 1.2) {
      const isOnOwnLine = this.isOnOwnLine(item, allItems);
      if (isOnOwnLine) {
        if (ratio >= 1.75) return 'h2';
        if (ratio >= 1.5) return 'h3';
        if (ratio >= 1.25) return 'h4';
      }
    }

    return undefined;
  }

  private isOnOwnLine(
    item: PDFTextContent,
    allItems: PDFTextContent[]
  ): boolean {
    const tolerance = item.height * 0.5;
    const sameLineItems = allItems.filter(
      i => Math.abs(i.y - item.y) < tolerance && i !== item
    );
    return sameLineItems.length === 0;
  }

  private detectTextDecoration(
    item: PDFTextContent
  ): 'none' | 'underline' | 'line-through' | 'overline' {
    if (item.textDecoration && item.textDecoration !== 'none') {
      return item.textDecoration;
    }

    const fontName = (item.fontInfo?.name || item.fontFamily).toLowerCase();

    if (fontName.includes('underline')) return 'underline';
    if (fontName.includes('strike') || fontName.includes('strikethrough')) return 'line-through';
    if (fontName.includes('overline')) return 'overline';

    return 'none';
  }

  /**
   * Groups text items into semantic blocks (paragraphs, lists, etc.)
   */
  groupIntoBlocks(
    items: ProcessedTextContent[]
  ): TextBlock[] {
    if (items.length === 0) return [];

    const blocks: TextBlock[] = [];
    let currentBlock: ProcessedTextContent[] = [];
    let currentY = items[0].y;
    const lineHeight = items[0].height * 1.5;

    for (const item of items.sort((a, b) => {
      // Sort by Y (top to bottom), then X (left to right)
      if (Math.abs(a.y - b.y) > lineHeight / 2) {
        return b.y - a.y; // Higher Y first (top of page)
      }
      return a.x - b.x;
    })) {
      const isNewLine = Math.abs(item.y - currentY) > lineHeight / 2;

      if (isNewLine && currentBlock.length > 0) {
        blocks.push(this.createBlock(currentBlock));
        currentBlock = [];
      }

      currentBlock.push(item);
      currentY = item.y;
    }

    if (currentBlock.length > 0) {
      blocks.push(this.createBlock(currentBlock));
    }

    return blocks;
  }

  private createBlock(items: ProcessedTextContent[]): TextBlock {
    const firstItem = items[0];
    const avgFontSize = items.reduce((sum, i) => sum + i.fontSize, 0) / items.length;

    // Detect if this is a list
    const isList = this.detectList(items);
    const semanticTag = firstItem.semanticTag || (avgFontSize > 14 ? 'h3' : 'p');

    return {
      items,
      semanticTag: isList ? 'ul' : semanticTag,
      x: Math.min(...items.map(i => i.x)),
      y: firstItem.y,
      width: Math.max(...items.map(i => i.x + i.width)) - Math.min(...items.map(i => i.x)),
      height: firstItem.height,
      fontSize: avgFontSize
    };
  }

  private detectList(items: ProcessedTextContent[]): boolean {
    if (items.length === 0) return false;

    // Check for list markers
    const firstText = items[0].text.trim();
    const listPatterns = [
      /^[-•·]\s/,           // Bullet points
      /^\d+[.)]\s/,         // Numbered lists
      /^[a-z][.)]\s/,       // Lettered lists
      /^[ivx]+[.)]\s/i      // Roman numerals
    ];

    return listPatterns.some(pattern => pattern.test(firstText));
  }
}

export interface TextBlock {
  items: ProcessedTextContent[];
  semanticTag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'ul' | 'ol' | 'li' | 'span' | 'strong' | 'em';
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

