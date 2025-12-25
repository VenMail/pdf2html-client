import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const demoDir = join(__dirname, '../../demo');
const pdfsDir = join(demoDir, 'demopdfs');

interface PdfAnalysisResult {
  success: boolean;
  fileName?: string;
  fileSize?: number;
  pageCount?: number;
  pages?: Array<{
    pageNumber: number;
    width: number;
    height: number;
    textItems: number;
    images: number;
    graphics: number;
    forms: number;
    annotations: number;
  }>;
  metadata?: unknown;
  uniqueFonts?: string[];
  totalTextItems?: number;
  totalImages?: number;
  totalGraphics?: number;
  processingTime?: number;
  error?: string;
}

test.describe('PDF Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-harness.html');
    await page.waitForFunction(
      () => (window as unknown as { __PDF2HTML_READY__?: boolean }).__PDF2HTML_READY__ === true,
      { timeout: 30000 }
    );
  });

  const testPDFs = [
    { name: 'Talent Agreement.pdf', expectedPages: 2 },
    { name: 'PermitOutcome_440112 (1).pdf', expectedPages: 1 },
    { name: '03.pdf', expectedPages: 15 },
    { name: 'company_profile.pdf', expectedPages: 24 },
  ];

  for (const pdfInfo of testPDFs) {
    test(`should analyze ${pdfInfo.name}`, async ({ page }) => {
      const pdfPath = join(pdfsDir, pdfInfo.name);
      if (!existsSync(pdfPath)) {
        test.skip();
        return;
      }

      const pdfBuffer = readFileSync(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');
      const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

      const analysis = await page.evaluate<PdfAnalysisResult, { pdfData: string; fileName: string }>(async ({ pdfData, fileName }) => {
        try {
          // Use PDF2HTML to parse the document
          const PDF2HTML = (window as unknown as { PDF2HTML?: unknown }).PDF2HTML;
          if (!PDF2HTML) {
            throw new Error('PDF2HTML not available');
          }

          const base64 = pdfData.split(',')[1] || '';
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const arrayBuffer = bytes.buffer;
          
          // Create a temporary converter to access the parser
          const converter = new (PDF2HTML as new (cfg: { enableOCR: boolean; enableFontMapping: boolean }) => {
            convert: (data: ArrayBuffer) => Promise<{ html: string; metadata: { pageCount: number; pages?: Array<{ width?: number; height?: number }> } }>;
            dispose: () => void;
          })({ enableOCR: false, enableFontMapping: false });
          
          // Access the internal parser (we'll need to expose this or use a different approach)
          // For now, let's use the converter's convert method and extract info from metadata
          const startTime = performance.now();
          const output = await converter.convert(arrayBuffer);
          const processingTime = performance.now() - startTime;
          
          // Extract analysis from the output
          const pages = output.metadata.pages || [];
          const uniqueFonts = new Set<string>();
          
          // Try to extract font info from HTML
          const fontMatches = output.html.match(/font-family:\s*['"]([^'"]+)['"]/g) || [];
          fontMatches.forEach((match: string) => {
            const font = match.match(/['"]([^'"]+)['"]/)?.[1];
            if (font) uniqueFonts.add(font);
          });
          
          converter.dispose();
          
          return {
            success: true,
            fileName,
            fileSize: pdfData.length,
            pageCount: output.metadata.pageCount,
            pages: pages.map((p, i: number) => ({
              pageNumber: i,
              width: p.width || 0,
              height: p.height || 0,
              textItems: 0, // Would need parser access
              images: 0,
              graphics: 0,
              forms: 0,
              annotations: 0,
            })),
            metadata: output.metadata,
            uniqueFonts: Array.from(uniqueFonts),
            totalTextItems: output.html.match(/<span|<p|<div/g)?.length || 0,
            totalImages: (output.html.match(/<img/g) || []).length,
            totalGraphics: 0,
            processingTime: Math.round(processingTime),
          };
        } catch (error) {
          const e = error as { message?: unknown };
          return {
            success: false,
            error: (typeof e?.message === 'string' && e.message.length > 0) ? e.message : String(error),
          };
        }
      }, { pdfData: pdfDataUrl, fileName: pdfInfo.name });

      expect(analysis.success, `Analysis should succeed for ${pdfInfo.name}`).toBe(true);
      expect(analysis.pageCount, `Page count should match for ${pdfInfo.name}`).toBe(pdfInfo.expectedPages);
      
      console.log(`\n📊 Analysis Results for ${pdfInfo.name}:`);
      console.log(`  Pages: ${analysis.pageCount}`);
      console.log(`  Text items: ${analysis.totalTextItems}`);
      console.log(`  Images: ${analysis.totalImages}`);
      console.log(`  Unique fonts: ${analysis.uniqueFonts?.length ?? 0}`);
      if ((analysis.uniqueFonts?.length ?? 0) > 0) {
        console.log(`  Fonts: ${(analysis.uniqueFonts ?? []).join(', ')}`);
      }
      console.log(`  Processing time: ${analysis.processingTime}ms`);
    });
  }

  test('should analyze cv.pdf', async ({ page }) => {
    const pdfPath = join(demoDir, 'cv.pdf');
    if (!existsSync(pdfPath)) {
      test.skip();
      return;
    }

    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    const analysis = await page.evaluate<PdfAnalysisResult, { pdfData: string; fileName: string }>(async ({ pdfData, fileName }) => {
      try {
        const PDF2HTML = (window as unknown as { PDF2HTML?: unknown }).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }

        const base64 = pdfData.split(',')[1] || '';
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const converter = new (PDF2HTML as new (cfg: { enableOCR: boolean; enableFontMapping: boolean }) => {
          convert: (data: ArrayBuffer) => Promise<{ html: string; metadata: { pageCount: number; pages?: Array<{ width?: number; height?: number }> } }>;
          dispose: () => void;
        })({ enableOCR: false, enableFontMapping: false });
        const startTime = performance.now();
        const output = await converter.convert(arrayBuffer);
        const processingTime = performance.now() - startTime;

        const pages = output.metadata.pages || [];
        const uniqueFonts = new Set<string>();

        const fontMatches = output.html.match(/font-family:\s*['"]([^'"]+)['"]/g) || [];
        fontMatches.forEach((match: string) => {
          const font = match.match(/['"]([^'"]+)['"]/)?.[1];
          if (font) uniqueFonts.add(font);
        });

        converter.dispose();

        return {
          success: true,
          fileName,
          fileSize: pdfData.length,
          pageCount: output.metadata.pageCount,
          pages: pages.map((p, i: number) => ({
            pageNumber: i,
            width: p.width || 0,
            height: p.height || 0,
            textItems: 0,
            images: 0,
            graphics: 0,
            forms: 0,
            annotations: 0,
          })),
          metadata: output.metadata,
          uniqueFonts: Array.from(uniqueFonts),
          totalTextItems: output.html.match(/<span|<p|<div/g)?.length || 0,
          totalImages: (output.html.match(/<img/g) || []).length,
          totalGraphics: 0,
          processingTime: Math.round(processingTime),
        };
      } catch (error) {
        const e = error as { message?: unknown };
        return {
          success: false,
          error: (typeof e?.message === 'string' && e.message.length > 0) ? e.message : String(error),
        };
      }
    }, { pdfData: pdfDataUrl, fileName: 'cv.pdf' });

    if (!analysis.success) {
      console.log(`\n❌ cv.pdf analysis failed: ${analysis.error || 'unknown error'}`);
    }
    expect(analysis.success, analysis.error || 'Analysis should succeed for cv.pdf').toBe(true);

    console.log(`\n📊 Analysis Results for cv.pdf:`);
    console.log(`  Pages: ${analysis.pageCount}`);
    console.log(`  Text items: ${analysis.totalTextItems}`);
    console.log(`  Images: ${analysis.totalImages}`);
    console.log(`  Unique fonts: ${analysis.uniqueFonts?.length ?? 0}`);
    if ((analysis.uniqueFonts?.length ?? 0) > 0) {
      console.log(`  Fonts: ${(analysis.uniqueFonts ?? []).join(', ')}`);
    }
    console.log(`  Processing time: ${analysis.processingTime}ms`);
  });
});

