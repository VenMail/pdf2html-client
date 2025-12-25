import type { PDFTextContent, PDFFontInfo } from '../types/pdf.js';
import { deriveFontWeightAndStyle } from '../fonts/font-style.js';

export interface PDFJSTextExtractionResult {
  text: PDFTextContent[];
  fonts: Map<string, PDFFontInfo>;
}

type PDFJSPage = {
  getTextContent: () => Promise<PDFJSTextContent>;
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
};

type PDFJSFontStyle = {
  fontFamily: string;
  fontSize: number;
  fontName?: string;
};

export class PDFJSTextExtractor {
  async extractText(page: PDFJSPage): Promise<PDFJSTextExtractionResult> {
    const textContents: PDFTextContent[] = [];
    const fonts = new Map<string, PDFFontInfo>();

    try {
      // Use permissive options by default to avoid text loss from item merging
      await this.collectText(page, textContents, fonts, {
        includeMarkedContent: true,
        disableCombineTextItems: true
      });
      // Some PDFs return no positioned items (e.g., pure XObjects or unusual encodings).
      // Retry once more without extra options in case implementations differ.
      if (textContents.length === 0 && (page as { getTextContent?: unknown }).getTextContent) {
        await this.collectText(page, textContents, fonts);
      }
    } catch (error) {
      console.warn('Failed to extract text from page:', error);
    }

    return {
      text: textContents,
      fonts
    };
  }

  private async collectText(
    page: PDFJSPage,
    textContents: PDFTextContent[],
    fonts: Map<string, PDFFontInfo>,
    options?: Record<string, unknown>
  ): Promise<void> {
    const textContent = await (page as PDFJSPage & {
      getTextContent?: (opts?: Record<string, unknown>) => Promise<PDFJSTextContent>;
    }).getTextContent?.(options) as PDFJSTextContent;

    for (const item of textContent.items) {
      const textItem = this.parseTextItem(item, textContent.styles);
      if (textItem) {
        textContents.push(textItem);

        // Extract font info if available
        if (item.fontName && textContent.styles[item.fontName]) {
          const fontKey = item.fontName;
          if (!fonts.has(fontKey)) {
            const fontInfo = this.extractFontInfo(
              item.fontName,
              textContent.styles[item.fontName]
            );
            if (fontInfo) {
              fonts.set(fontKey, fontInfo);
            }
          }
        }
      }
    }
  }

  private parseTextItem(
    item: PDFJSTextItem,
    styles: Record<string, PDFJSFontStyle>
  ): PDFTextContent | null {
    if (!item.str || item.str.trim().length === 0) {
      return null;
    }

    // PDF.js uses 4x4 transformation matrix: [a, b, c, d, e, f]
    // e = x translation, f = y translation
    const transform = item.transform || [1, 0, 0, 1, 0, 0];
    const [a, b, c, d, e, f] = transform;
    const x = e;
    // Keep PDF-space Y (origin bottom-left). We invert once later in the layout engine.
    const y = f;
    const rotationRad = Math.atan2(b, a);
    const rotationDeg = (rotationRad * 180) / Math.PI;

    const style = item.fontName ? styles[item.fontName] : null;
    
    // Derive fontSize: prefer style.fontSize, but if it's suspiciously low (<=2px)
    // and height is reasonable (>=4px), use height as fontSize instead.
    // This handles corrupted PDFs where fontSize is 1px but height values are correct.
    const rawFontSize = style?.fontSize || 12;
    const itemHeight = typeof item.height === 'number' ? item.height : 0;
    const fontSize = (rawFontSize <= 2 && itemHeight >= 4) ? itemHeight : (rawFontSize || itemHeight || 12);
    
    const fontFamily = style?.fontFamily || 'Arial';
    const { fontWeight: weight, fontStyle: styleHint } = deriveFontWeightAndStyle({
      fontName: style?.fontName || item.fontName || '',
      fontFamily,
      fontFlags: 0
    });

    // Estimate width and height.
    // IMPORTANT: pdf.js text items often provide `item.width`/`item.height` in page units already.
    // Applying the transform scale again will double-scale and produce huge boxes.
    // Only use transform-derived scale factors when we have to fall back to estimation.
    const scaleX = Math.hypot(a, b) || 1;
    const scaleY = Math.hypot(c, d) || 1;
    const baseWidth = typeof item.width === 'number' ? item.width : item.str.length * fontSize * 0.6;
    const baseHeight = typeof item.height === 'number' ? item.height : fontSize;

    const rawWidth = typeof item.width === 'number' ? baseWidth : baseWidth * scaleX;
    const rawHeight = typeof item.height === 'number' ? baseHeight : baseHeight * scaleY;

    const width = Math.abs(rotationDeg % 180) === 90 ? rawHeight : rawWidth;
    const height = Math.abs(rotationDeg % 180) === 90 ? rawWidth : rawHeight;

    return {
      text: item.str,
      x,
      y,
      width,
      height,
      fontSize,
      fontFamily,
      fontWeight: weight,
      fontStyle: styleHint,
      color: '#000000', // Default, could be extracted from graphics state
      fontInfo: item.fontName ? this.extractFontInfo(item.fontName, style as PDFJSFontStyle | undefined) as PDFFontInfo | undefined : undefined,
      rotation: rotationDeg
    };
  }

  private extractFontInfo(
    fontName: string,
    style: PDFJSFontStyle | undefined
  ): PDFFontInfo | null {
    if (!style) {
      return null;
    }

    // Extract font characteristics from font name
    // const _isBold = fontName.toLowerCase().includes('bold');
    // const _isItalic = fontName.toLowerCase().includes('italic') || 
    //                  fontName.toLowerCase().includes('oblique');

    return {
      name: fontName,
      embedded: false, // PDF.js doesn't directly tell us this
      subset: fontName.includes('+'), // Subset fonts often have '+' prefix
      encoding: 'WinAnsi', // Default, could be extracted
      metrics: {
        ascent: style.fontSize * 0.8, // Estimate
        descent: style.fontSize * 0.2, // Estimate
        capHeight: style.fontSize * 0.7, // Estimate
        xHeight: style.fontSize * 0.5, // Estimate
        averageWidth: style.fontSize * 0.6, // Estimate
        maxWidth: style.fontSize * 1.2 // Estimate
      }
    };
  }
}

