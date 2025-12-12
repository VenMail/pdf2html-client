import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pdfsDir = join(__dirname, '../../demo/pdfs');

test.describe('PDF Analysis', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-harness.html');
    await page.waitForFunction(() => (window as any).__PDF2HTML_READY__ === true, { timeout: 30000 });
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
      if (!readFileSync(pdfPath)) {
        test.skip();
        return;
      }

      const pdfBuffer = readFileSync(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');
      const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

      const analysis = await page.evaluate(async (pdfData, fileName) => {
        try {
          // Use PDF2HTML to parse the document
          const PDF2HTML = (window as any).PDF2HTML;
          if (!PDF2HTML) {
            throw new Error('PDF2HTML not available');
          }
          
          // Create a temporary converter to access the parser
          const converter = new PDF2HTML({ enableOCR: false, enableFontMapping: false });
          
          // Access the internal parser (we'll need to expose this or use a different approach)
          // For now, let's use the converter's convert method and extract info from metadata
          const startTime = performance.now();
          const output = await converter.convert(pdfData);
          const processingTime = performance.now() - startTime;
          
          // Extract analysis from the output
          const pages = output.metadata.pages || [];
          const uniqueFonts = new Set<string>();
          
          // Try to extract font info from HTML
          const fontMatches = output.html.match(/font-family:\s*['"]([^'"]+)['"]/g) || [];
          fontMatches.forEach(match => {
            const font = match.match(/['"]([^'"]+)['"]/)?.[1];
            if (font) uniqueFonts.add(font);
          });
          
          converter.dispose();
          
          return {
            success: true,
            fileName,
            fileSize: pdfData.length,
            pageCount: output.metadata.pageCount,
            pages: pages.map((p: any, i: number) => ({
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
        } catch (error: any) {
          return {
            success: false,
            error: error.message || String(error),
          };
        }
      }, pdfDataUrl, pdfInfo.name);
        
        const document = await parser.parse(pdfData, {
          extractText: true,
          extractImages: true,
          extractGraphics: true,
          extractForms: true,
          extractAnnotations: true,
        });

        const pages = document.pages.map(page => ({
          pageNumber: page.pageNumber,
          width: page.width,
          height: page.height,
          textItems: page.content.text.length,
          images: page.content.images.length,
          graphics: page.content.graphics.length,
          forms: page.content.forms.length,
          annotations: page.content.annotations.length,
        }));

        const uniqueFonts = new Set<string>();
        document.pages.forEach(page => {
          page.content.text.forEach(text => {
            if (text.fontFamily) {
              uniqueFonts.add(text.fontFamily);
            }
          });
        });

        parser.dispose();

        return {
          success: true,
          fileName: 'test.pdf',
          fileSize: 0,
          pageCount: document.pageCount,
          pages,
          metadata: document.metadata,
          uniqueFonts: Array.from(uniqueFonts),
          totalTextItems: pages.reduce((sum, p) => sum + p.textItems, 0),
          totalImages: pages.reduce((sum, p) => sum + p.images, 0),
          totalGraphics: pages.reduce((sum, p) => sum + p.graphics, 0),
        };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || String(error),
        };
      }
    }, pdfDataUrl);

      expect(analysis.success, `Analysis should succeed for ${pdfInfo.name}`).toBe(true);
      expect(analysis.pageCount, `Page count should match for ${pdfInfo.name}`).toBe(pdfInfo.expectedPages);
      
      console.log(`\n📊 Analysis Results for ${pdfInfo.name}:`);
      console.log(`  Pages: ${analysis.pageCount}`);
      console.log(`  Text items: ${analysis.totalTextItems}`);
      console.log(`  Images: ${analysis.totalImages}`);
      console.log(`  Unique fonts: ${analysis.uniqueFonts.length}`);
      if (analysis.uniqueFonts.length > 0) {
        console.log(`  Fonts: ${analysis.uniqueFonts.join(', ')}`);
      }
      console.log(`  Processing time: ${analysis.processingTime}ms`);
    });
  }
});

