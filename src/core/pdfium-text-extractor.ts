import type { PDFTextContent, PDFFontInfo } from '../types/pdf.js';
import { deriveFontWeightAndStyle } from '../fonts/font-style.js';

export interface PDFiumTextExtractionResult {
  text: PDFTextContent[];
  fonts: Map<string, PDFFontInfo>;
}

type PDFiumPage = {
  getWidth?: () => number;
  getHeight?: () => number;
  getText?: () => Promise<string> | string;
  getTextWithPosition?: () => Promise<PDFiumTextItem[]>;
};

type PDFiumTextItem = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName?: string;
};

export class PDFiumTextExtractor {
  async extractText(page: PDFiumPage): Promise<PDFiumTextExtractionResult> {
    const textContents: PDFTextContent[] = [];
    const fonts = new Map<string, PDFFontInfo>();

    const pageHeight = typeof page.getHeight === 'function' ? page.getHeight() : 0;

    try {
      // Try to get text with positioning if available
      if (page.getTextWithPosition) {
        const textItems = await page.getTextWithPosition();
        
        for (const item of textItems) {
          const textContent = this.parseTextItem(item, pageHeight);
          if (textContent) {
            textContents.push(textContent);

            // Extract font info if available
            if (item.fontName && !fonts.has(item.fontName)) {
              const fontInfo = this.extractFontInfo(item);
              if (fontInfo) {
                fonts.set(item.fontName, fontInfo);
              }
            }
          }
        }
      } else {
        // Fallback: get plain text and estimate positions
        const text = typeof page.getText === 'function' ? await page.getText() : '';
        if (text) {
          // Split text into lines and estimate positions
          const lines = text.split('\n');
          const fontSize = 12; // Default estimate
          const lineHeight = fontSize * 1.2;

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim()) {
              textContents.push({
                text: lines[i],
                x: 0,
                y: pageHeight - (i * lineHeight) - fontSize,
                width: lines[i].length * fontSize * 0.6,
                height: fontSize,
                fontSize,
                fontFamily: 'Arial',
                fontWeight: 400,
                fontStyle: 'normal',
                color: '#000000'
              });
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to extract text from PDFium page:', error);
    }

    return {
      text: textContents,
      fonts
    };
  }

  private parseTextItem(
    item: PDFiumTextItem,
    pageHeight: number
  ): PDFTextContent | null {
    if (!item.text || item.text.trim().length === 0) {
      return null;
    }

    // PDFium coordinates: origin at bottom-left
    // Convert to top-left origin
    const y = pageHeight - item.y - item.height;

    const fontName = item.fontName || '';
    const derived = deriveFontWeightAndStyle({ fontName, fontFamily: fontName, fontFlags: 0 });

    return {
      text: item.text,
      x: item.x,
      y,
      width: item.width,
      height: item.height,
      fontSize: item.fontSize,
      fontFamily: fontName || 'Arial',
      fontWeight: derived.fontWeight,
      fontStyle: derived.fontStyle,
      color: '#000000',
      fontInfo: item.fontName ? this.extractFontInfo(item) as PDFFontInfo | undefined : undefined
    };
  }

  private extractFontInfo(item: PDFiumTextItem): PDFFontInfo | null {
    if (!item.fontName) {
      return null;
    }

    // Extract font characteristics from font name
    // const _isBold = item.fontName.toLowerCase().includes('bold');
    // const _isItalic = item.fontName.toLowerCase().includes('italic') ||
    //                   item.fontName.toLowerCase().includes('oblique');

    return {
      name: item.fontName,
      embedded: false, // PDFium doesn't directly tell us this
      subset: item.fontName.includes('+'),
      encoding: 'WinAnsi',
      metrics: {
        ascent: (item.fontSize || 12) * 0.8,
        descent: (item.fontSize || 12) * 0.2,
        capHeight: (item.fontSize || 12) * 0.7,
        xHeight: (item.fontSize || 12) * 0.5,
        averageWidth: (item.fontSize || 12) * 0.6,
        maxWidth: (item.fontSize || 12) * 1.2
      }
    };
  }
}

