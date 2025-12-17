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

  it('should convert underline path graphics into text-decoration underline and remove the graphic', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true
    });

    const pageHeight = 792;
    const y = 700;
    const textHeight = 10;
    const underlineY = pageHeight - y - textHeight + textHeight + 2;

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: pageHeight,
          content: {
            text: [
              { text: 'Underlined', x: 50, y, width: 80, height: textHeight, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
            ],
            images: [],
            graphics: [
              { type: 'path', path: `M 50 ${underlineY} L 130 ${underlineY}`, stroke: '#000000', strokeWidth: 1 }
            ],
            forms: [],
            annotations: []
          }
        }
      ]
    };

    const output = generator.generate(mockDocument, [], { pageCount: 1, processingTime: 0, ocrUsed: false, fontMappings: 0 });

    expect(output.html).toContain('Underlined');
    expect(output.css).toMatch(/text-decoration\s*:\s*underline/);
    expect(output.html).not.toContain('<path d="M 50');
  });

  it('should convert underline rectangle graphics into text-decoration underline and remove the graphic', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true
    });

    const pageHeight = 792;
    const y = 700;
    const textHeight = 10;
    const underlineY = pageHeight - y - textHeight + textHeight + 2;

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: pageHeight,
          content: {
            text: [
              { text: 'Underlined', x: 50, y, width: 80, height: textHeight, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
            ],
            images: [],
            graphics: [
              { type: 'rectangle', x: 50, y: underlineY, width: 80, height: 1, stroke: '#000000', strokeWidth: 1 }
            ],
            forms: [],
            annotations: []
          }
        }
      ]
    };

    const output = generator.generate(mockDocument, [], { pageCount: 1, processingTime: 0, ocrUsed: false, fontMappings: 0 });

    expect(output.html).toContain('Underlined');
    expect(output.css).toMatch(/text-decoration\s*:\s*underline/);
    expect(output.html).not.toContain('<rect');
  });

  it('should convert underline line graphics into text-decoration underline and remove the graphic', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true
    });

    const pageHeight = 792;
    const y = 700;
    const textHeight = 10;
    const underlineY = pageHeight - y - textHeight + textHeight + 2;

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: pageHeight,
          content: {
            text: [
              { text: 'Underlined', x: 50, y, width: 80, height: textHeight, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
            ],
            images: [],
            graphics: [
              { type: 'line', x: 50, y: underlineY, width: 80, height: 0, stroke: '#000000', strokeWidth: 1 }
            ],
            forms: [],
            annotations: []
          }
        }
      ]
    };

    const output = generator.generate(mockDocument, [], { pageCount: 1, processingTime: 0, ocrUsed: false, fontMappings: 0 });

    expect(output.html).toContain('Underlined');
    expect(output.css).toMatch(/text-decoration\s*:\s*underline/);
    expect(output.html).not.toContain('<line');
  });

  it('should not convert long fill-line separators into underline styling', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true
    });

    const pageHeight = 792;
    const y = 700;
    const textHeight = 10;
    const underlineY = pageHeight - y - textHeight + textHeight + 2;

    const mockDocument: PDFDocument = {
      pageCount: 1,
      metadata: {},
      pages: [
        {
          pageNumber: 0,
          width: 612,
          height: pageHeight,
          content: {
            text: [
              { text: 'Name:', x: 50, y, width: 35, height: textHeight, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
            ],
            images: [],
            graphics: [
              { type: 'line', x: 90, y: underlineY, width: 480, height: 0, stroke: '#000000', strokeWidth: 1 }
            ],
            forms: [],
            annotations: []
          }
        }
      ]
    };

    const output = generator.generate(mockDocument, [], { pageCount: 1, processingTime: 0, ocrUsed: false, fontMappings: 0 });

    expect(output.html).toContain('Name:');
    expect(output.css).not.toMatch(/text-decoration\s*:\s*underline/);
    expect(output.html).toContain('<line');
  });

  it('should avoid injecting whitespace padding between opening quote and following word (semantic flexbox)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true
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
              { text: 'Agreement (“', x: 50, y, width: 80, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Agreement', x: 131, y, width: 60, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: '”)', x: 192, y, width: 12, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
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

    expect(output.html).toContain('Agreement');

    const m = output.html.match(/<span class="pdf-sem-text" style="([^"]*)">\s*<strong[^>]*>Agreement<\/strong>/);
    expect(m, 'Expected to find a semantic text wrapper for bold Agreement').not.toBeNull();
    const style = m ? m[1] : '';
    expect(style).not.toMatch(/padding-left\s*:/);
    expect(style).not.toMatch(/padding-right\s*:/);
  });

  it('should merge same-style consecutive lines into a flowing paragraph when enabled (semantic flexbox)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true,
      semanticPositionedLayout: { mergeSameStyleLines: true }
    });

    const y1 = 700;
    const y2 = 686;
    const y3 = 672;

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
              { text: 'First bold line', x: 50, y: y1, width: 120, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: 'Second bold line', x: 50, y: y2, width: 140, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: 'Third bold line', x: 50, y: y3, width: 130, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' }
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

    expect(output.html).toContain('pdf-sem-paragraph');
    expect(output.html).toContain('First bold line');
    expect(output.html).toContain('Second bold line');
    expect(output.html).toContain('Third bold line');
    const paraCount = (output.html.match(/pdf-sem-paragraph/g) || []).length;
    expect(paraCount).toBeGreaterThanOrEqual(1);
  });

  it('should merge multi-run lines when all runs share the same style (semantic flexbox)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true,
      semanticPositionedLayout: { mergeSameStyleLines: true }
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
              // Line 1 split into multiple bold runs
              { text: 'including any', x: 50, y: y1, width: 70, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: ' agreed TOP', x: 122, y: y1, width: 70, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              // Line 2 split into multiple bold runs
              { text: 'electronic and', x: 50, y: y2, width: 75, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: ' is not signed', x: 127, y: y2, width: 75, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' }
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

    expect(output.html).toContain('pdf-sem-paragraph');
    expect(output.html).toContain('including any');
    expect(output.html).toContain('agreed TOP');
    expect(output.html).toContain('electronic and');
    expect(output.html).toContain('is not signed');
  });

  it('should not merge same-style lines when a region looks structured (large column gaps) (semantic flexbox)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true,
      semanticPositionedLayout: { mergeSameStyleLines: true }
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
              // Table-like header row with large gaps between columns
              { text: 'Flight', x: 50, y: y1, width: 40, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Terminal/Gate', x: 200, y: y1, width: 90, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Boarding Time', x: 350, y: y1, width: 90, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Seat', x: 520, y: y1, width: 30, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              // Second row, still table-like
              { text: 'ET902', x: 50, y: y2, width: 45, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: '21:15', x: 350, y: y2, width: 35, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: '27B', x: 520, y: y2, width: 25, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
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

    // We should fall back to per-line positioned rendering inside the region (no paragraph merging)
    expect(output.html).not.toContain('pdf-sem-paragraph');
    expect(output.html).toContain('pdf-sem-line');
    expect(output.html).toContain('Flight');
    expect(output.html).toContain('Terminal/Gate');
    expect(output.html).toContain('Boarding Time');
    expect(output.html).toContain('Seat');
  });

  it('should preserve mixed inline styling and punctuation when merging lines into a paragraph (semantic flexbox)', () => {
    const generator = new HTMLGenerator({
      format: 'html+inline-css',
      preserveLayout: true,
      textLayout: 'semantic',
      responsive: true,
      darkMode: false,
      imageFormat: 'base64',
      useFlexboxLayout: true,
      semanticPositionedLayout: { mergeSameStyleLines: true }
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
              // Line 1: mixed styles and curly quotes
              { text: 'This is an ', x: 50, y: y1, width: 55, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Agreement', x: 106, y: y1, width: 60, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'normal', color: '#000000' },
              { text: ' (“', x: 168, y: y1, width: 12, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              { text: 'Agreement', x: 182, y: y1, width: 60, height: 10, fontSize: 10, fontFamily: 'DejaVuSans-Bold', fontWeight: 700, fontStyle: 'italic', color: '#000000' },
              { text: '”) and more.', x: 244, y: y1, width: 70, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' },
              // Line 2: continuation with different emphasis
              { text: 'Second line continues.', x: 50, y: y2, width: 120, height: 10, fontSize: 10, fontFamily: 'DejaVuSans', fontWeight: 400, fontStyle: 'normal', color: '#000000' }
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

    expect(output.html).toContain('pdf-sem-paragraph');
    expect(output.html).toContain('“');
    expect(output.html).toContain('”');
    const boldCount = (output.html.match(/<strong[^>]*>Agreement<\/strong>/g) || []).length;
    expect(boldCount).toBeGreaterThanOrEqual(1);
    const emCount = (output.html.match(/<em[^>]*>Agreement<\/em>/g) || []).length;
    expect(emCount).toBeGreaterThanOrEqual(1);
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


