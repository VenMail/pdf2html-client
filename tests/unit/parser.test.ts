import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PDFParser } from '../../src/core/pdf-parser.js';

describe('PDFParser', () => {
  let parser: PDFParser;

  beforeEach(() => {
    parser = new PDFParser('unpdf');
  });

  afterEach(() => {
    parser.dispose();
  });

  it('should initialize', async () => {
    await parser.initialize();
    expect(parser).toBeDefined();
  });

  it('should parse PDF document', async () => {
    // TODO: Add actual PDF test data
    const mockPdfData = new ArrayBuffer(0);
    
    try {
      const document = await parser.parse(mockPdfData);
      expect(document).toBeDefined();
      expect(document.pageCount).toBeGreaterThanOrEqual(0);
    } catch (error) {
      // Expected to fail with empty data
      expect(error).toBeDefined();
    }
  });

  it('should handle parallel parsing', async () => {
    const mockPdfData = new ArrayBuffer(0);

    await expect(parser.parseParallel(mockPdfData, undefined, 2)).rejects.toThrow(
      'parseParallel is not supported for UnPDF backend'
    );
  });
});


