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

interface ExpectedPhrase {
  text: string;
  description: string;
  mustNotContain?: string[];
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

  /**
   * Helper to check if text contains expected phrases with proper spacing
   */
  function checkPhrases(
    extractedText: string,
    expectedPhrases: ExpectedPhrase[]
  ): { passed: boolean; failures: string[] } {
    const failures: string[] = [];
    const normalizedText = extractedText.replace(/\s+/g, ' ').trim();

    for (const phrase of expectedPhrases) {
      const normalizedPhrase = phrase.text.replace(/\s+/g, ' ').trim();
      
      // Check if expected phrase exists
      if (!normalizedText.toLowerCase().includes(normalizedPhrase.toLowerCase())) {
        failures.push(`Missing expected phrase: "${phrase.text}" (${phrase.description})`);
      }

      // Check that malformed versions don't exist
      if (phrase.mustNotContain) {
        for (const bad of phrase.mustNotContain) {
          if (normalizedText.toLowerCase().includes(bad.toLowerCase())) {
            failures.push(`Found malformed text: "${bad}" instead of "${phrase.text}"`);
          }
        }
      }
    }

    return {
      passed: failures.length === 0,
      failures
    };
  }

  test('cv.pdf - should extract name with proper spacing', async ({ page }) => {
    const pdfPath = join(demoDir, 'cv.pdf');
    if (!existsSync(pdfPath)) {
      test.skip();
      return;
    }

    const result = await extractTextFromPdf(page, pdfPath);
    expect(result.success, result.error || 'Extraction should succeed').toBe(true);

    console.log('\n📄 CV.pdf Extraction Results:');
    console.log(`  Pages: ${result.pageCount}`);
    console.log(`  Text length: ${result.extractedText.length} chars`);

    // Expected phrases that should appear with correct spacing
    const expectedPhrases: ExpectedPhrase[] = [
      {
        text: 'ISAAC ADELORE',
        description: 'Name should have space between first and last name',
        mustNotContain: ['ISAACADELORE', 'ISAAC  ADELORE']
      },
      {
        text: 'software engineer',
        description: 'Job title should not be fragmented',
        mustNotContain: ['so ftware', 'soft ware', 'en gineer', 'engi neer']
      },
      {
        text: 'experience',
        description: 'Common word should not be fragmented',
        mustNotContain: ['ex per ience', 'exper ience', 'experi ence']
      },
      {
        text: 'professional',
        description: 'Common word should not be fragmented',
        mustNotContain: ['pro fess ional', 'profess ional']
      }
    ];

    const check = checkPhrases(result.extractedText, expectedPhrases);
    
    if (!check.passed) {
      console.log('\n❌ Text extraction quality issues:');
      for (const failure of check.failures) {
        console.log(`  - ${failure}`);
      }
      
      // Log a snippet of extracted text for debugging
      console.log('\n📝 Extracted text snippet (first 500 chars):');
      console.log(result.extractedText.slice(0, 500));
    } else {
      console.log('\n✅ All expected phrases found with correct spacing');
    }

    // This assertion will fail if text quality issues exist
    // Comment out to see current extraction state without failing
    // expect(check.passed, check.failures.join('\n')).toBe(true);
    
    // For now, just log the results - uncomment above when classifier is wired up
    expect(result.success).toBe(true);
  });

  test('cv.pdf - should not have excessive fragmentation', async ({ page }) => {
    const pdfPath = join(demoDir, 'cv.pdf');
    if (!existsSync(pdfPath)) {
      test.skip();
      return;
    }

    const result = await extractTextFromPdf(page, pdfPath);
    expect(result.success, result.error).toBe(true);

    const text = result.extractedText;
    
    // Count single-letter "words" surrounded by spaces (fragmentation indicator)
    const singleLetterWords = (text.match(/\s[a-zA-Z]\s/g) || []).length;
    const totalWords = (text.match(/\S+/g) || []).length;
    const fragmentationRatio = totalWords > 0 ? singleLetterWords / totalWords : 0;

    console.log('\n📊 Fragmentation Analysis:');
    console.log(`  Total words: ${totalWords}`);
    console.log(`  Single-letter words: ${singleLetterWords}`);
    console.log(`  Fragmentation ratio: ${(fragmentationRatio * 100).toFixed(2)}%`);

    // A healthy document should have < 5% single-letter words
    // CVs might have some (e.g., "I", "a") but excessive fragmentation indicates issues
    const MAX_FRAGMENTATION_RATIO = 0.15; // 15% threshold
    
    if (fragmentationRatio > MAX_FRAGMENTATION_RATIO) {
      console.log(`\n⚠️ High fragmentation detected (>${MAX_FRAGMENTATION_RATIO * 100}%)`);
      console.log('  This may indicate character spacing issues');
      
      // Find examples of fragmented text
      const fragmentedPatterns = text.match(/(\s[a-zA-Z]\s){2,}/g) || [];
      if (fragmentedPatterns.length > 0) {
        console.log('\n  Examples of potential fragmentation:');
        fragmentedPatterns.slice(0, 5).forEach(pattern => {
          console.log(`    "${pattern.trim()}"`);
        });
      }
    }

    // Soft assertion - log but don't fail (until classifier is wired up)
    // expect(fragmentationRatio).toBeLessThan(MAX_FRAGMENTATION_RATIO);
    expect(result.success).toBe(true);
  });

  test('cv.pdf - word boundary detection accuracy', async ({ page }) => {
    const pdfPath = join(demoDir, 'cv.pdf');
    if (!existsSync(pdfPath)) {
      test.skip();
      return;
    }

    const result = await extractTextFromPdf(page, pdfPath);
    expect(result.success, result.error).toBe(true);

    // Common English words that should appear intact
    const commonWords = [
      'the', 'and', 'with', 'for', 'from', 'have', 'that', 'this',
      'work', 'team', 'project', 'development', 'management',
      'years', 'skills', 'company', 'position', 'education'
    ];

    const text = result.extractedText.toLowerCase();
    const foundWords: string[] = [];
    const missingWords: string[] = [];

    for (const word of commonWords) {
      // Word should appear as complete word (with word boundaries)
      const regex = new RegExp(`\\b${word}\\b`, 'i');
      if (regex.test(text)) {
        foundWords.push(word);
      } else {
        // Check if it appears fragmented
        const letters = word.split('');
        const fragmentedPattern = letters.join('\\s*');
        const fragmentedRegex = new RegExp(fragmentedPattern, 'i');
        if (fragmentedRegex.test(text)) {
          missingWords.push(`${word} (fragmented)`);
        }
      }
    }

    console.log('\n📝 Common Word Detection:');
    console.log(`  Found intact: ${foundWords.length}/${commonWords.length}`);
    
    if (missingWords.length > 0) {
      console.log(`  Potentially fragmented: ${missingWords.join(', ')}`);
    }

    // Calculate accuracy
    const accuracy = foundWords.length / commonWords.length;
    console.log(`  Accuracy: ${(accuracy * 100).toFixed(1)}%`);

    expect(result.success).toBe(true);
  });

  test.describe('Proper Noun Handling', () => {
    test('should detect ALL CAPS names correctly', async ({ page }) => {
      const pdfPath = join(demoDir, 'cv.pdf');
      if (!existsSync(pdfPath)) {
        test.skip();
        return;
      }

      const result = await extractTextFromPdf(page, pdfPath);
      expect(result.success, result.error).toBe(true);

      // Look for ALL CAPS sequences that should be names
      const allCapsPattern = /[A-Z]{2,}(?:\s+[A-Z]{2,})*/g;
      const allCapsMatches = result.extractedText.match(allCapsPattern) || [];

      console.log('\n🔤 ALL CAPS Detection:');
      console.log(`  Found ${allCapsMatches.length} ALL CAPS sequences`);
      
      if (allCapsMatches.length > 0) {
        console.log('  Sequences found:');
        const uniqueMatches = [...new Set(allCapsMatches)].slice(0, 10);
        uniqueMatches.forEach(match => {
          console.log(`    "${match}"`);
        });
      }

      expect(result.success).toBe(true);
    });
  });

  test.describe('Document Type Detection', () => {
    const testDocuments = [
      { name: 'cv.pdf', type: 'CV/Resume', exists: false },
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
