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
      darkMode: false,
      imageFormat: 'base64'
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

  it('should preserve bold segments in smart text flow (passes>=2)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'smart',
      textLayoutPasses: 2,
      responsive: true,
      darkMode: false,
      imageFormat: 'base64'
    });

    const y1 = 700;
    const y2 = 686;

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: 792,
          content: {
            text: [
              // Line 1: normal + bold + normal
              { text: 'with an address ', x: 36, y: y1, width: 120, height: 10, fontSize: 10, fontFamily: 'TimesNewRomanPSMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Toptal, LLC', x: 165, y: y1, width: 70, height: 10, fontSize: 10, fontFamily: 'TimesNewRomanPS-BoldMT', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: ', a Delaware company', x: 240, y: y1, width: 140, height: 10, fontSize: 10, fontFamily: 'TimesNewRomanPSMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              // Line 2 (to enable region flow)
              { text: 'Second line continues here.', x: 36, y: y2, width: 160, height: 10, fontSize: 10, fontFamily: 'TimesNewRomanPSMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
            ],
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
    expect(output.html).toContain('Toptal, LLC');
    expect(output.html).toMatch(/font-weight: 700;/);
  });

  it('should avoid intra-word splits in extracted text (v2 pipeline)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'smart',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      includeExtractedText: true,
      textPipeline: 'v2',
      textClassifierProfile: 'latin-default'
    });

    const y = 700;

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: 792,
          content: {
            text: [
              { text: 'fl', x: 36, y, width: 12, height: 10, fontSize: 10, fontFamily: 'ArialMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'ight', x: 47, y, width: 22, height: 10, fontSize: 10, fontFamily: 'ArialMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Boarding', x: 100, y, width: 45, height: 10, fontSize: 10, fontFamily: 'ArialMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Time', x: 162, y, width: 24, height: 10, fontSize: 10, fontFamily: 'ArialMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: '21:', x: 200, y, width: 16, height: 10, fontSize: 10, fontFamily: 'ArialMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: '15', x: 218, y, width: 12, height: 10, fontSize: 10, fontFamily: 'ArialMT', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
            ],
            images: [],
            graphics: [],
            forms: [],
            annotations: []
          }
        }
      ]
    };

    const output = generator.generate(mockDocument, [], { pageCount: 1, processingTime: 0, ocrUsed: false, fontMappings: 0 });
    const text = output.text || '';
    expect(text).toContain('flight');
    expect(text).not.toMatch(/\bfl\s+ight\b/i);
    expect(text).toMatch(/\bBoarding\s+Time\b/i);
    expect(text).toMatch(/\b21\s*:\s*15\b/);
  });
});


