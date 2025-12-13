import type { PDFTextContent, PDFFontInfo } from '../types/pdf.js';

export interface SmartTextExtractionResult {
  text: PDFTextContent[];
  fonts: Map<string, PDFFontInfo>;
}

type PDFJSPage = {
  getTextContent: (options?: Record<string, unknown>) => Promise<PDFJSTextContent>;
  getViewport: (options: { scale: number }) => { width: number; height: number };
  rotate?: number;
};

type PDFJSTextContent = {
  items: PDFJSTextItem[];
  styles: Record<string, PDFJSFontStyle>;
};

type PDFJSTextItem = {
  str: string;
  transform: number[];
  fontName?: string;
  width?: number;
  height?: number;
  dir?: string;
  hasEOL?: boolean;
};

type PDFJSFontStyle = {
  fontFamily: string;
  fontSize: number;
  fontName?: string;
  ascent?: number;
  descent?: number;
};

interface TextLine {
  items: PDFJSTextItem[];
  y: number;
  minX: number;
  maxX: number;
  avgFontSize: number;
}

export class SmartTextExtractor {

  async extractText(page: PDFJSPage): Promise<SmartTextExtractionResult> {
    const textContents: PDFTextContent[] = [];
    const fonts = new Map<string, PDFFontInfo>();

    try {
      const textContent = await page.getTextContent({
        includeMarkedContent: true,
        disableCombineTextItems: true
      });

      if (textContent.items.length === 0) {
        return { text: textContents, fonts };
      }

      const lines = this.groupTextIntoLines(textContent.items, textContent.styles);
      const processedItems = this.processLines(lines, textContent.styles, fonts);

      textContents.push(...processedItems);
    } catch (error) {
      console.warn('Failed to extract text from page:', error);
    }

    return {
      text: textContents,
      fonts
    };
  }

  private groupTextIntoLines(
    items: PDFJSTextItem[],
    styles: Record<string, PDFJSFontStyle>
  ): TextLine[] {
    if (items.length === 0) return [];

    const lines: TextLine[] = [];
    const tolerance = 2;

    for (const item of items) {
      if (!item.str || item.str.trim().length === 0) continue;

      const transform = item.transform || [1, 0, 0, 1, 0, 0];
      const [, , , , , y] = transform;
      const style = item.fontName ? styles[item.fontName] : null;
      const fontSize = style?.fontSize || item.height || 12;

      let foundLine = false;
      for (const line of lines) {
        if (Math.abs(line.y - y) < tolerance) {
          line.items.push(item);
          line.minX = Math.min(line.minX, transform[4]);
          line.maxX = Math.max(line.maxX, transform[4] + (item.width || 0));
          foundLine = true;
          break;
        }
      }

      if (!foundLine) {
        const x = transform[4];
        lines.push({
          items: [item],
          y,
          minX: x,
          maxX: x + (item.width || 0),
          avgFontSize: fontSize
        });
      }
    }

    lines.sort((a, b) => {
      const yDiff = b.y - a.y;
      if (Math.abs(yDiff) > 2) return yDiff;
      return a.minX - b.minX;
    });

    return lines;
  }

  private processLines(
    lines: TextLine[],
    styles: Record<string, PDFJSFontStyle>,
    fonts: Map<string, PDFFontInfo>
  ): PDFTextContent[] {
    const textContents: PDFTextContent[] = [];

    for (const line of lines) {
      line.items.sort((a, b) => {
        const aX = (a.transform || [1, 0, 0, 1, 0, 0])[4];
        const bX = (b.transform || [1, 0, 0, 1, 0, 0])[4];
        return aX - bX;
      });

      for (const item of line.items) {
        const textContent = this.parseTextItem(item, styles, fonts);
        if (textContent) {
          textContents.push(textContent);
        }
      }
    }

    return textContents;
  }

  private parseTextItem(
    item: PDFJSTextItem,
    styles: Record<string, PDFJSFontStyle>,
    fonts: Map<string, PDFFontInfo>
  ): PDFTextContent | null {
    if (!item.str || item.str.trim().length === 0) {
      return null;
    }

    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const [a, b] = transform;

    const position = this.calculatePosition(transform);
    const rotation = this.calculateRotation(a, b);

    const style = item.fontName ? styles[item.fontName] : null;
    const fontSize = style?.fontSize || item.height || 12;
    const fontFamily = style?.fontFamily || 'Arial';

    const dimensions = this.calculateDimensions(
      item,
      fontSize,
      rotation
    );

    const format = this.extractFormat(item, style);

      if (item.fontName && !fonts.has(item.fontName)) {
        const fontInfo = this.extractFontInfo(item.fontName, style || undefined);
        if (fontInfo) {
          fonts.set(item.fontName, fontInfo);
        }
      }

    return {
      text: item.str,
      x: position.x,
      y: position.y,
      width: dimensions.width,
      height: dimensions.height,
      fontSize,
      fontFamily,
      fontWeight: format.fontWeight,
      fontStyle: format.fontStyle,
      color: format.color,
      fontInfo: item.fontName ? fonts.get(item.fontName) : undefined,
      rotation: rotation.degrees
    };
  }

  private calculatePosition(transform: number[]): { x: number; y: number } {
    const [, , , , e, f] = transform;
    return {
      x: e,
      y: f
    };
  }

  private calculateRotation(
    a: number,
    b: number
  ): { radians: number; degrees: number } {
    const radians = Math.atan2(b, a);
    const degrees = (radians * 180) / Math.PI;
    return { radians, degrees };
  }

  private calculateDimensions(
    item: PDFJSTextItem,
    fontSize: number,
    rotation: { degrees: number }
  ): { width: number; height: number } {
    // Use item.width if available (most accurate), otherwise estimate
    // For better fidelity, prefer item.width which comes from PDF.js font metrics
    let baseWidth = item.width;
    if (!baseWidth || baseWidth <= 0) {
      // Estimate based on character count and font size
      // Average character width is typically 0.6 * fontSize for most fonts
      baseWidth = item.str.length * fontSize * 0.6;
    }
    
    let baseHeight = item.height;
    if (!baseHeight || baseHeight <= 0) {
      baseHeight = fontSize;
    }

    const rawWidth = baseWidth;
    const rawHeight = baseHeight;

    // Handle rotation - swap dimensions for 90/270 degree rotations
    const isRotated = Math.abs(rotation.degrees % 180) === 90;
    const width = isRotated ? rawHeight : rawWidth;
    const height = isRotated ? rawWidth : rawHeight;

    return { width: Math.max(width, 0), height: Math.max(height, 0) };
  }

  private extractFormat(
    item: PDFJSTextItem,
    style: PDFJSFontStyle | null | undefined
  ): { fontWeight: number; fontStyle: 'normal' | 'italic' | 'oblique'; color: string } {
    const fontName = (style?.fontName || item.fontName || '').toLowerCase();

    let fontWeight = 400;
    if (fontName.includes('thin') || fontName.includes('100')) fontWeight = 100;
    else if (fontName.includes('extralight') || fontName.includes('200')) fontWeight = 200;
    else if (fontName.includes('light') || fontName.includes('300')) fontWeight = 300;
    else if (fontName.includes('regular') || fontName.includes('normal') || fontName.includes('400')) fontWeight = 400;
    else if (fontName.includes('medium') || fontName.includes('500')) fontWeight = 500;
    else if (fontName.includes('semibold') || fontName.includes('600')) fontWeight = 600;
    else if (fontName.includes('bold') || fontName.includes('700')) fontWeight = 700;
    else if (fontName.includes('extrabold') || fontName.includes('800')) fontWeight = 800;
    else if (fontName.includes('black') || fontName.includes('900')) fontWeight = 900;

    let fontStyle: 'normal' | 'italic' | 'oblique' = 'normal';
    if (fontName.includes('italic')) fontStyle = 'italic';
    else if (fontName.includes('oblique')) fontStyle = 'oblique';

    const color = '#000000';

    return { fontWeight, fontStyle, color };
  }

  private extractFontInfo(
    fontName: string,
    style: PDFJSFontStyle | undefined
  ): PDFFontInfo | null {
    if (!style) {
      return null;
    }

    const fontSize = style.fontSize || 12;
    const ascent = style.ascent !== undefined ? style.ascent : fontSize * 0.8;
    const descent = style.descent !== undefined ? style.descent : fontSize * 0.2;

    return {
      name: fontName,
      embedded: false,
      subset: fontName.includes('+'),
      encoding: 'WinAnsi',
      metrics: {
        ascent,
        descent,
        capHeight: fontSize * 0.7,
        xHeight: fontSize * 0.5,
        averageWidth: fontSize * 0.6,
        maxWidth: fontSize * 1.2
      }
    };
  }
}

