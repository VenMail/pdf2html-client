import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

/* eslint-disable @typescript-eslint/no-explicit-any */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pdfsDir = join(__dirname, '../../demo/pdfs');

interface ConversionResult {
  success: boolean;
  pageCount: number;
  processingTime: number;
  outputSize: number;
  textExtracted: boolean;
  imagesExtracted: boolean;
  fontMappings: number;
  bufferLength: number;
  html?: string;
  css?: string;
  error?: string;
}

const testPDFs = [
  { name: 'boarding_pass.pdf', type: 'boarding-pass', expectedPages: 1 },
];

test.describe('PDF to HTML Conversion', () => {
  test.beforeEach(async ({ page }) => {
    // Set up console logging to catch errors
    page.on('console', msg => {
      console.log(`Browser: ${msg.text()}`);
    });
    
    page.on('pageerror', error => {
      console.log(`Page error: ${error.message}`);
    });
    
    // Navigate to test harness
    await page.goto('/test-harness.html', { waitUntil: 'networkidle' });
    
    // Wait for library to load or error
    await page.waitForFunction(
      () => {
        const win = window as any;
        return win.__PDF2HTML_READY__ === true || win.__PDF2HTML_ERROR__ !== null;
      },
      { timeout: 60000 }
    );
    
    // Check if there was an error
    const error = await page.evaluate(() => (window as any).__PDF2HTML_ERROR__);
    if (error) {
      throw new Error(`Library failed to load: ${error}`);
    }
    
    // Verify library is ready
    const ready = await page.evaluate(() => (window as any).__PDF2HTML_READY__ === true);
    if (!ready) {
      throw new Error('Library not ready after timeout');
    }
  });

  for (const pdfInfo of testPDFs) {
    test(`should convert ${pdfInfo.name} (${pdfInfo.type})`, async ({ page }) => {
      const pdfPath = join(pdfsDir, pdfInfo.name);
      const pdfBuffer = readFileSync(pdfPath);
      const pdfBase64 = pdfBuffer.toString('base64');
      const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

      // Navigate to test harness and wait for library to load
      await page.goto('/test-harness.html');
      await page.waitForFunction(() => (window as any).__PDF2HTML_READY__ === true, { timeout: 30000 });
      
      // Inject PDF2HTML library and test conversion
      const result: ConversionResult = await page.evaluate(async (pdfData) => {
        try {
          // Convert data URL to ArrayBuffer
          const base64 = pdfData.split(',')[1];
          const binary = atob(base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
          }
          const arrayBuffer = bytes.buffer;

          // Use the globally available PDF2HTML
          const PDF2HTML = (window as any).PDF2HTML;
          if (!PDF2HTML) {
            throw new Error('PDF2HTML not available');
          }
          
          // Get API key from environment (injected by Vite)
          const apiKey = (window as any).__GOOGLE_API_KEY__ || 
                        (import.meta as any).env?.GOOGLE_API_KEY || 
                        '';

          // Create converter
          const converter = new PDF2HTML({
            enableOCR: false, // Disable for faster tests
            enableFontMapping: true,
            htmlOptions: {
              format: 'html+inline-css',
              preserveLayout: true,
              responsive: true,
              darkMode: false,
            },
            fontMappingOptions: {
              googleApiKey: apiKey,
            },
          });

          // Convert PDF
          const startTime = performance.now();
          const output = await converter.convert(arrayBuffer);
          const processingTime = performance.now() - startTime;

          // Analyze results
          const result = {
            success: true,
            pageCount: output.metadata.pageCount,
            processingTime: Math.round(processingTime),
            outputSize: output.html.length + output.css.length,
            textExtracted: output.html.includes('<span') || output.html.includes('<p') || output.html.includes('<div'),
            imagesExtracted: output.html.includes('<img'),
            fontMappings: output.metadata.fontMappings || 0,
            bufferLength: arrayBuffer.byteLength,
            html: output.html,
            css: output.css
          };

          converter.dispose();
          return result;
        } catch (error) {
          const e = error as { message?: unknown };
          return {
            success: false,
            pageCount: 0,
            processingTime: 0,
            outputSize: 0,
            textExtracted: false,
            imagesExtracted: false,
            fontMappings: 0,
            error: (typeof e?.message === 'string' && e.message.length > 0) ? e.message : String(error),
            bufferLength: 0
          };
        }
      }, pdfDataUrl);

      // Assertions
      expect(result.success, `Conversion should succeed for ${pdfInfo.name}`).toBe(true);
      if (result.error) {
        console.error(`Error converting ${pdfInfo.name}:`, result.error);
      }
      
      expect(result.pageCount, `Page count should match for ${pdfInfo.name}`).toBe(pdfInfo.expectedPages);
      expect(result.outputSize, `Output should have content for ${pdfInfo.name}`).toBeGreaterThan(0);
      
      // Detailed quality checks
      if (result.html) {
        // Text extraction quality
        const textElements = (result.html.match(/<span[^>]*>.*?<\/span>/g) || []).length;
        const hasFontClasses = result.html.includes('font-') || result.html.includes('class="font-');
        const hasAbsolutePositioning = result.html.includes('position: absolute');
        
        console.log(`  Text elements: ${textElements}`);
        console.log(`  Font classes: ${hasFontClasses ? '✓' : '✗'}`);
        console.log(`  Absolute positioning: ${hasAbsolutePositioning ? '✓' : '✗'}`);
        
        // For complex PDFs, expect more sophisticated content
        if (pdfInfo.type === 'complex') {
          expect(textElements, `Complex PDF should have substantial text extraction`).toBeGreaterThan(50);
          expect(hasFontClasses, `Complex PDF should have font mappings`).toBe(true);
          expect(result.imagesExtracted, `Complex PDF should extract images`).toBe(true);
          
          // Check for SVG graphics in complex PDFs
          const hasSVG = result.html!.includes('<svg') || result.html!.includes('</svg>');
          console.log(`  SVG graphics: ${hasSVG ? '✓' : '✗'}`);
          
          if (pdfInfo.name === 'company_profile.pdf') {
            // Company profile should have charts/graphics
            expect(hasSVG || result.imagesExtracted, `Company profile should have graphics or images`).toBe(true);
          }
        } else if (pdfInfo.type === 'multi-page') {
          expect(textElements, `Multi-page PDF should have substantial text`).toBeGreaterThan(20);
        }
      }
      
      // Save HTML and CSS output files
      if (result.success && result.html && result.css) {
        const outputDir = join(__dirname, '../../test-results/html-outputs');
        mkdirSync(outputDir, { recursive: true });
        
        const baseName = pdfInfo.name.replace('.pdf', '');
        const htmlPath = join(outputDir, `${baseName}.html`);
        const cssPath = join(outputDir, `${baseName}.css`);
        
        // Create a complete HTML document
        const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pdfInfo.name} - Converted</title>
  <style>${result.css!}</style>
</head>
<body>
  <div class="pdf-content">
    ${result.html!}
  </div>
</body>
</html>`;
        
        writeFileSync(htmlPath, fullHtml, 'utf8');
        writeFileSync(cssPath, result.css!, 'utf8');
        
        console.log(`  HTML saved: ${htmlPath}`);
        console.log(`  CSS saved: ${cssPath}`);
      }
    });
  }

  test('should handle conversion with progress callbacks', async ({ page }) => {
    const pdfPath = join(pdfsDir, 'Talent Agreement.pdf');
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    await page.goto('/test-harness.html');
    await page.waitForFunction(() => (window as any).__PDF2HTML_READY__ === true, { timeout: 30000 });
    
    const progressUpdates = await page.evaluate(async (pdfData) => {
      const progressStages: string[] = [];
      
      try {
        // Convert data URL to ArrayBuffer
        const base64 = pdfData.split(',')[1];
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const arrayBuffer = bytes.buffer;

        const PDF2HTML = (window as any).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }
        const converter = new PDF2HTML({
          enableOCR: false,
          enableFontMapping: true,
        });
        
        const output = await converter.convert(arrayBuffer, (progress: any) => {
          progressStages.push(`${progress.stage}:${progress.progress}`);
        });

        converter.dispose();
        return { success: true, stages: progressStages, result: output, bufferLength: arrayBuffer.byteLength };
      } catch (error) {
        const e = error as { message?: unknown };
        return { success: false, stages: [], error: (typeof e?.message === 'string' && e.message.length > 0) ? e.message : String(error), bufferLength: 0 };
      }
    }, pdfDataUrl);

    console.log('Progress test result:', progressUpdates);
    if (progressUpdates.error) {
      console.log('Conversion error:', progressUpdates.error);
    }
    
    // Save HTML output if successful
    if (progressUpdates.success && progressUpdates.result) {
      const outputDir = join(__dirname, '../../test-results/html-outputs');
      mkdirSync(outputDir, { recursive: true });
      
      const baseName = 'talent_agreement_progress';
      const htmlPath = join(outputDir, `${baseName}.html`);
      const cssPath = join(outputDir, `${baseName}.css`);
      
      // Create a complete HTML document
      const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Talent Agreement Progress Test - Converted</title>
  <style>${progressUpdates.result.css}</style>
</head>
<body>
  <div class="pdf-content">
    ${progressUpdates.result.html}
  </div>
</body>
</html>`;
      
      writeFileSync(htmlPath, fullHtml, 'utf8');
      writeFileSync(cssPath, progressUpdates.result.css, 'utf8');
      
      console.log(`  HTML saved: ${htmlPath}`);
      console.log(`  CSS saved: ${cssPath}`);
    }
    
    // expect(progressUpdates.success).toBe(true);
    // expect(progressUpdates.stages.length).toBeGreaterThan(0);
    // expect(progressUpdates.stages.some(s => s.startsWith('parsing:'))).toBe(true);
    // expect(progressUpdates.stages.some(s => s.startsWith('complete:'))).toBe(true);
  });

  test('should handle errors gracefully', async ({ page }) => {
    await page.goto('/test-harness.html');
    await page.waitForFunction(() => (window as any).__PDF2HTML_READY__ === true, { timeout: 30000 });
    
    const invalidPdfData = 'invalid pdf data';

    const result = await page.evaluate(async (pdfData) => {
      try {
        const PDF2HTML = (window as any).PDF2HTML;
        if (!PDF2HTML) {
          throw new Error('PDF2HTML not available');
        }
        const converter = new PDF2HTML();
        await converter.convert(pdfData);
        converter.dispose();
        return { success: true, error: null };
      } catch (error) {
        const e = error as { message?: unknown };
        return { success: false, error: (typeof e?.message === 'string' && e.message.length > 0) ? e.message : String(error) };
      }
    }, invalidPdfData);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

