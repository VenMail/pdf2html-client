import { describe, it, expect, vi } from 'vitest';
import { PDFJSWrapper } from '../../src/core/pdfjs-wrapper.js';

// Mock pdfjs-dist OPS constants so extractGraphics can work without real pdf.js
vi.mock('pdfjs-dist', () => ({
  OPS: {
    save: 0,
    restore: 1,
    transform: 2,
    rectangle: 3,
    stroke: 4
  }
}));

describe('PDFJSWrapper extractGraphics', () => {
  it('extracts rectangle graphics with CTM applied', async () => {
    const wrapper = new PDFJSWrapper();
    // Inject OPS directly so extractGraphics doesn't rely on dynamic import behavior in Vitest
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (wrapper as any).pdfjsLib = {
      OPS: {
        save: 0,
        restore: 1,
        transform: 2,
        rectangle: 3,
        stroke: 4
      }
    };
    type MockPage = {
      getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }>;
    };

    const mockPage: MockPage = {
      getOperatorList: async () => ({
        fnArray: [2, 3, 4],
        argsArray: [
          // transform: translate (10, 20)
          [1, 0, 0, 1, 10, 20],
          // rectangle: x=5,y=5,width=100,height=50
          [5, 5, 100, 50],
          // stroke: no args
          []
        ]
      })
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const graphics = await (wrapper as any).extractGraphics(mockPage, 500);
    expect(graphics).toHaveLength(1);
    const rect = graphics[0];
    expect(rect.type).toBe('path');
    expect(typeof rect.path).toBe('string');
    // Rectangle is encoded as a path: starts at transformed (x,y)
    // After CTM translate(10,20): x=5+10 => 15. yPdf=5+20 => 25. yHtml=500-25 => 475.
    expect(rect.path).toContain('M 15 475');
  });
});
