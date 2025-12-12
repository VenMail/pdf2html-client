import { describe, it, expect } from 'vitest';
import { HTMLGenerator } from '../../src/html/html-generator.js';
import type { PDFDocument } from '../../src/types/pdf.js';
import type { FontMapping } from '../../src/types/fonts.js';

describe('HTMLGenerator', () => {
  it('should generate HTML output', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      responsive: true,
      darkMode: false
    });

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: 792,
          content: {
            text: [],
            images: [],
            graphics: [],
            forms: [],
            annotations: []
          }
        }
      ]
    };

    const fontMappings: FontMapping[] = [];
    const metadata = {
      pageCount: 1,
      processingTime: 100,
      ocrUsed: false,
      fontMappings: 0
    };

    const output = generator.generate(mockDocument, fontMappings, metadata);

    expect(output).toBeDefined();
    expect(output.html).toContain('<!DOCTYPE html>');
    expect(output.html).toContain('<html');
    expect(output.css).toBeDefined();
  });
});


