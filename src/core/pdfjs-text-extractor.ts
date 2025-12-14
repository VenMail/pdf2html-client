import type { PDFTextContent, PDFFontInfo } from '../types/pdf.js';

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
    const fontSize = style?.fontSize || item.height || 12;
    const fontFamily = style?.fontFamily || 'Arial';
    const fontNameLower = (style?.fontName || item.fontName || '').toLowerCase();
    const fontFamilyLower = (fontFamily || '').toLowerCase();

    const deriveWeight = (s: string): number => {
      if (!s) return 400;
      if (s.includes('thin') || s.includes('100')) return 100;
      if (s.includes('extralight') || s.includes('200')) return 200;
      if (s.includes('light') || s.includes('300')) return 300;
      if (s.includes('medium') || s.includes('500')) return 500;
      if (s.includes('semibold') || s.includes('600')) return 600;
      if (s.includes('bold') || s.includes('700')) return 700;
      if (s.includes('extrabold') || s.includes('800')) return 800;
      if (s.includes('black') || s.includes('900')) return 900;
      return 400;
    };

    const deriveStyle = (s: string): 'normal' | 'italic' | 'oblique' => {
      if (!s) return 'normal';
      if (s.includes('italic')) return 'italic';
      if (s.includes('oblique')) return 'oblique';
      return 'normal';
    };

    const weight = Math.max(deriveWeight(fontNameLower), deriveWeight(fontFamilyLower));
    const styleHint = (deriveStyle(fontNameLower) !== 'normal') ? deriveStyle(fontNameLower) : deriveStyle(fontFamilyLower);

    // Estimate width and height
    // Use transform scale when present to avoid clipping rotated/scaled text
    const baseWidth = item.width || (item.str.length * fontSize * 0.6);
    const scaleX = Math.hypot(a, b) || 1;
    const scaleY = Math.hypot(c, d) || 1;
    const rawWidth = baseWidth * scaleX;
    const rawHeight = (item.height || fontSize) * scaleY;
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

