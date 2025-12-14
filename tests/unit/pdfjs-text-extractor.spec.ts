import { describe, it, expect } from 'vitest';
import { PDFJSTextExtractor } from '../../src/core/pdfjs-text-extractor.js';

type MockTextItem = {
  str: string;
  transform: number[];
  fontName: string;
  width?: number;
  height?: number;
};

type MockStyle = { fontFamily: string; fontSize: number };

// Minimal mock page that matches the extractor contract
const makePage = (
  items: MockTextItem[],
  styles: Record<string, MockStyle>,
  viewportHeight = 1000
) => ({
  getTextContent: async () => ({
    items,
    styles
  }),
  getViewport: () => ({ width: 600, height: viewportHeight })
});

describe('PDFJSTextExtractor', () => {
  it('extracts rotation and scaled dimensions from transform matrix', async () => {
    const extractor = new PDFJSTextExtractor();
    const items: MockTextItem[] = [
      {
        str: 'Rotated',
        // 90deg rotation: matrix [0 1 -1 0 10 20]
        transform: [0, 1, -1, 0, 10, 20],
        fontName: 'F1',
        width: 50,
        height: 12
      }
    ];
    const styles: Record<string, MockStyle> = {
      F1: { fontFamily: 'Arial', fontSize: 12 }
    };

    const page = makePage(items, styles) as unknown as {
      getTextContent: () => Promise<{ items: MockTextItem[]; styles: Record<string, MockStyle> }>;
      getViewport: (options: { scale: number }) => { width: number; height: number };
    };
    const result = await extractor.extractText(page);
    expect(result.text).toHaveLength(1);
    const text = result.text[0];
    expect(text.rotation).toBeCloseTo(90, 5);
    // y is kept in PDF space (origin bottom-left) and flipped later in layout/rendering
    expect(text.y).toBeCloseTo(20);
    // width/height scaled by matrix magnitude (here scale 1)
    expect(text.width).toBeGreaterThan(0);
    expect(text.height).toBeGreaterThan(0);
  });
});
