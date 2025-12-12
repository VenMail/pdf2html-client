import { describe, it, expect, vi } from 'vitest';
import { PDFJSWrapper } from '../../src/core/pdfjs-wrapper.js';

// Mock pdfjs-dist OPS constants so extractGraphics can work without real pdf.js
vi.mock('pdfjs-dist', () => ({
  OPS: {
    save: 0,
    restore: 1,
    transform: 2,
    rectangle: 3
  }
}));

describe('PDFJSWrapper extractGraphics', () => {
  it('extracts rectangle graphics with CTM applied', async () => {
    const wrapper = new PDFJSWrapper();
    type MockPage = {
      getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
    };

    const mockPage: MockPage = {
      getOperatorList: async () => ({
        fnArray: [2, 3],
        argsArray: [
          // transform: translate (10, 20)
          [1, 0, 0, 1, 10, 20],
          // rectangle: x=5,y=5,width=100,height=50
          [5, 5, 100, 50]
        ]
      })
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graphics = await (wrapper as any).extractGraphics(mockPage, 500);
    expect(graphics).toHaveLength(1);
    const rect = graphics[0];
    expect(rect.type).toBe('rectangle');
    expect(rect.x).toBeCloseTo(15); // translated by +10
    expect(rect.y).toBeCloseTo(500 - 25 - 50); // y conversion: pageHeight - yPdf - height
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(50);
  });
});
