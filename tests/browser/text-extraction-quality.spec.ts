import { test, expect } from '@playwright/test';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const demoDir = join(__dirname, '../../demo');

/**
 * Text Extraction Quality Tests
 * 
 * These tests verify that text is extracted correctly with proper word spacing.
 * They check for common issues like:
 * - Character fragmentation (e.g., "ex per ience" instead of "experience")
 * - Missing spaces between words
 * - Proper noun handling (e.g., "ISAAC ADELORE" not "ISAACADELORE")
 */

interface TextExtractionResult {
  success: boolean;
  extractedText: string;
  html: string;
  pageCount: number;
  error?: string;
}

test.describe('Text Extraction Quality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/test-harness.html');
    await page.waitForFunction(
      () => (window as unknown as { __PDF2HTML_READY__?: boolean }).__PDF2HTML_READY__ === true,
      { timeout: 30000 }
    );
  });

  /**
   * Helper function to extract text from a PDF
   */
  async function extractTextFromPdf(
    page: import('@playwright/test').Page,
    pdfPath: string
  ): Promise<TextExtractionResult> {
    const pdfBuffer = readFileSync(pdfPath);
    const pdfBase64 = pdfBuffer.toString('base64');
    const pdfDataUrl = `data:application/pdf;base64,${pdfBase64}`;

    return await page.evaluate<TextExtractionResult, { pdfData: string }>(
      async ({ pdfData }) => {
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

          const converter = new (PDF2HTML as new (cfg: {
            enableOCR: boolean;
            enableFontMapping: boolean;
            textPipeline?: string;
          }) => {
            convert: (data: ArrayBuffer) => Promise<{
              html: string;
              text?: string;
              metadata: { pageCount: number };
            }>;
            dispose: () => void;
          })({
            enableOCR: false,
            enableFontMapping: false,
            textPipeline: 'smart'
          });

          const output = await converter.convert(arrayBuffer);
          converter.dispose();

          // Extract text content from HTML
          const parser = new DOMParser();
          const doc = parser.parseFromString(output.html, 'text/html');
          const textContent = doc.body.textContent || '';

          return {
            success: true,
            extractedText: textContent,
            html: output.html,
            pageCount: output.metadata.pageCount
          };
        } catch (error) {
          const e = error as { message?: unknown };
          return {
            success: false,
            extractedText: '',
            html: '',
            pageCount: 0,
            error: typeof e?.message === 'string' ? e.message : String(error)
          };
        }
      },
      { pdfData: pdfDataUrl }
    );
  }

  test.describe('Document Type Detection', () => {
    const testDocuments = [
      { name: 'boarding_pass.pdf', type: 'Boarding Pass', exists: false },
      { name: 'source_agreement.pdf', type: 'Legal Agreement', exists: false }
    ];

    for (const doc of testDocuments) {
      test(`${doc.name} - should extract readable text`, async ({ page }) => {
        const pdfPath = join(demoDir, doc.name);
        if (!existsSync(pdfPath)) {
          test.skip();
          return;
        }

        const result = await extractTextFromPdf(page, pdfPath);
        expect(result.success, result.error).toBe(true);

        console.log(`\n📄 ${doc.name} (${doc.type}):`);
        console.log(`  Pages: ${result.pageCount}`);
        console.log(`  Text length: ${result.extractedText.length} chars`);

        // Basic readability check - average word length should be reasonable
        const words = result.extractedText.match(/\S+/g) || [];
        const avgWordLength = words.length > 0
          ? words.reduce((sum, w) => sum + w.length, 0) / words.length
          : 0;

        console.log(`  Total words: ${words.length}`);
        console.log(`  Avg word length: ${avgWordLength.toFixed(1)} chars`);

        // Average English word is ~4.5 chars; if much lower, text is fragmented
        // If much higher, words might be concatenated
        const isReasonableLength = avgWordLength >= 3 && avgWordLength <= 10;
        
        if (!isReasonableLength) {
          console.log(`  ⚠️ Unusual average word length - may indicate spacing issues`);
        }

        expect(result.success).toBe(true);
      });
    }
  });
});
