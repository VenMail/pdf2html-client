import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PDF2HTML } from '../../src/index.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { HTMLOutput } from '../../src/types';

interface TestPDF {
  name: string;
  path: string;
  expectedPages: number;
  complexity: 'simple' | 'medium' | 'complex';
  features: {
    text: boolean;
    images: boolean;
    tables: boolean;
    forms: boolean;
    graphics: boolean;
    ocr: boolean;
  };
}

const testPDFs: TestPDF[] = [
  {
    name: 'Talent Agreement',
    path: join(process.cwd(), 'demo', 'pdfs', 'Talent Agreement.pdf'),
    expectedPages: 1,
    complexity: 'simple',
    features: {
      text: true,
      images: false,
      tables: false,
      forms: false,
      graphics: false,
      ocr: false
    }
  },
  {
    name: 'Permit Outcome',
    path: join(process.cwd(), 'demo', 'pdfs', 'PermitOutcome_440112 (1).pdf'),
    expectedPages: 1,
    complexity: 'medium',
    features: {
      text: true,
      images: true,
      tables: false,
      forms: false,
      graphics: false,
      ocr: false
    }
  },
  {
    name: '03.pdf',
    path: join(process.cwd(), 'demo', 'pdfs', '03.pdf'),
    expectedPages: 15,
    complexity: 'medium',
    features: {
      text: true,
      images: true,
      tables: false,
      forms: false,
      graphics: true,
      ocr: false
    }
  },
  {
    name: 'Company Profile',
    path: join(process.cwd(), 'demo', 'pdfs', 'company_profile.pdf'),
    expectedPages: 24,
    complexity: 'complex',
    features: {
      text: true,
      images: true,
      tables: true,
      forms: false,
      graphics: true,
      ocr: false
    }
  }
];

describe('PDF Test Suite - Real PDFs', () => {
  let converter: PDF2HTML;

  beforeAll(() => {
    converter = new PDF2HTML({
      enableOCR: false, // Disable for faster tests, enable separately
      enableFontMapping: true,
      htmlOptions: {
        format: 'html+inline-css',
        preserveLayout: true,
        responsive: true,
        darkMode: false
      }
    });
  });

  afterAll(() => {
    converter.dispose();
  });

  for (const pdf of testPDFs) {
    describe(pdf.name, () => {
      it(`should exist and be readable`, () => {
        expect(existsSync(pdf.path)).toBe(true);
        
        const stats = require('fs').statSync(pdf.path);
        expect(stats.size).toBeGreaterThan(0);
      });

      it(`should parse PDF successfully`, async () => {
        if (!existsSync(pdf.path)) {
          console.warn(`PDF not found: ${pdf.path}`);
          return;
        }

        const pdfBuffer = readFileSync(pdf.path);
        const arrayBuffer = pdfBuffer.buffer.slice(
          pdfBuffer.byteOffset,
          pdfBuffer.byteOffset + pdfBuffer.byteLength
        );

        const progressUpdates: string[] = [];
        
        try {
          const output = await converter.convert(arrayBuffer, (progress) => {
            progressUpdates.push(`${progress.stage}: ${progress.progress}%`);
          });

          expect(output).toBeDefined();
          expect(output.html).toBeDefined();
          expect(output.css).toBeDefined();
          expect(output.metadata.pageCount).toBeGreaterThan(0);
          
          console.log(`✓ ${pdf.name}: ${output.metadata.pageCount} pages, ${output.metadata.processingTime}ms`);
          console.log(`  Progress: ${progressUpdates.join(' -> ')}`);
        } catch (error) {
          console.error(`✗ ${pdf.name} failed:`, error);
          throw error;
        }
      }, 60000); // 60 second timeout for large PDFs

      it(`should extract text content`, async () => {
        if (!existsSync(pdf.path)) {
          return;
        }

        const pdfBuffer = readFileSync(pdf.path);
        const arrayBuffer = pdfBuffer.buffer.slice(
          pdfBuffer.byteOffset,
          pdfBuffer.byteOffset + pdfBuffer.byteLength
        );

        const output = await converter.convert(arrayBuffer);
        
        // Check if HTML contains text
        const hasText = output.html.includes('<span') || 
                       output.html.includes('<p') ||
                       output.html.length > 1000; // Basic check
        
        if (pdf.features.text) {
          expect(hasText).toBe(true);
        }
      }, 60000);

      it(`should generate valid HTML`, async () => {
        if (!existsSync(pdf.path)) {
          return;
        }

        const pdfBuffer = readFileSync(pdf.path);
        const arrayBuffer = pdfBuffer.buffer.slice(
          pdfBuffer.byteOffset,
          pdfBuffer.byteOffset + pdfBuffer.byteLength
        );

        const output = await converter.convert(arrayBuffer);
        
        // Basic HTML validation
        expect(output.html).toContain('<!DOCTYPE html>');
        expect(output.html).toContain('<html');
        expect(output.html).toContain('</html>');
        expect(output.html.length).toBeGreaterThan(100);
      }, 60000);

      it(`should generate CSS`, async () => {
        if (!existsSync(pdf.path)) {
          return;
        }

        const pdfBuffer = readFileSync(pdf.path);
        const arrayBuffer = pdfBuffer.buffer.slice(
          pdfBuffer.byteOffset,
          pdfBuffer.byteOffset + pdfBuffer.byteLength
        );

        const output = await converter.convert(arrayBuffer);
        
        expect(output.css).toBeDefined();
        expect(output.css.length).toBeGreaterThan(0);
      }, 60000);

      it(`should handle errors gracefully`, async () => {
        // Test with invalid data
        const invalidData = new ArrayBuffer(100);
        
        await expect(converter.convert(invalidData)).rejects.toThrow();
      });
    });
  }

  describe('Performance Tests', () => {
    it('should process simple PDF quickly', async () => {
      const pdf = testPDFs.find(p => p.complexity === 'simple');
      if (!pdf || !existsSync(pdf.path)) return;

      const pdfBuffer = readFileSync(pdf.path);
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength
      );

      const startTime = Date.now();
      await converter.convert(arrayBuffer);
      const duration = Date.now() - startTime;

      console.log(`Simple PDF processing time: ${duration}ms`);
      expect(duration).toBeLessThan(10000); // Should complete in <10s
    }, 15000);

    it('should process complex PDF within reasonable time', async () => {
      const pdf = testPDFs.find(p => p.complexity === 'complex');
      if (!pdf || !existsSync(pdf.path)) return;

      const pdfBuffer = readFileSync(pdf.path);
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength
      );

      const startTime = Date.now();
      await converter.convert(arrayBuffer);
      const duration = Date.now() - startTime;

      console.log(`Complex PDF processing time: ${duration}ms`);
      expect(duration).toBeLessThan(120000); // Should complete in <2min
    }, 150000);
  });

  describe('Memory Tests', () => {
    it('should not crash on large PDF', async () => {
      const pdf = testPDFs.find(p => p.name === 'Company Profile');
      if (!pdf || !existsSync(pdf.path)) return;

      const pdfBuffer = readFileSync(pdf.path);
      const arrayBuffer = pdfBuffer.buffer.slice(
        pdfBuffer.byteOffset,
        pdfBuffer.byteOffset + pdfBuffer.byteLength
      );

      // Monitor memory if possible
      const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;

      await converter.convert(arrayBuffer);

      const finalMemory = (performance as any).memory?.usedJSHeapSize || 0;
      const memoryIncrease = finalMemory - initialMemory;

      console.log(`Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)} MB`);
      
      // Should not exceed 500MB for this PDF
      if (memoryIncrease > 0) {
        expect(memoryIncrease).toBeLessThan(500 * 1024 * 1024);
      }
    }, 180000);
  });
});


