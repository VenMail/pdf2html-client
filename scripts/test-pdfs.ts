#!/usr/bin/env node
/**
 * PDF Testing Script
 * 
 * Tests the PDF2HTML library with real PDF files from demo/pdfs
 * Generates detailed reports and saves HTML outputs
 */

import 'dotenv/config';
import { PDF2HTML } from '../src/index.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestResult {
  pdfName: string;
  success: boolean;
  error?: string;
  pageCount: number;
  processingTime: number;
  outputSize: number;
  textExtracted: boolean;
  imagesExtracted: boolean;
  fontMappings: number;
  htmlGenerated: boolean;
}

const testPDFs = [
  'Talent Agreement.pdf',
  'PermitOutcome_440112 (1).pdf',
  '03.pdf',
  'company_profile.pdf'
];

async function testPDF(pdfPath: string): Promise<TestResult> {
  const pdfName = basename(pdfPath);
  const result: TestResult = {
    pdfName,
    success: false,
    pageCount: 0,
    processingTime: 0,
    outputSize: 0,
    textExtracted: false,
    imagesExtracted: false,
    fontMappings: 0,
    htmlGenerated: false
  };

  try {
    console.log(`\n📄 Testing: ${pdfName}`);
    console.log('─'.repeat(60));

    if (!existsSync(pdfPath)) {
      result.error = `PDF file not found: ${pdfPath}`;
      return result;
    }

    const pdfBuffer = readFileSync(pdfPath);
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    );

    const fileSizeMB = (pdfBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`   Size: ${fileSizeMB} MB`);

    // Get API key from environment
    const apiKey = process.env.GOOGLE_API_KEY;
    if (apiKey) {
      // Make API key available for font mapper
      (global as any).__GOOGLE_API_KEY__ = apiKey;
    }

    const converter = new PDF2HTML({
      enableOCR: false, // Disable for faster tests
      enableFontMapping: true,
      htmlOptions: {
        format: 'html+inline-css',
        preserveLayout: true,
        responsive: true,
        darkMode: false
      }
    });

    const startTime = Date.now();
    let progressStage = '';

    const output = await converter.convert(arrayBuffer, (progress) => {
      if (progress.stage !== progressStage) {
        progressStage = progress.stage;
        console.log(`   ${progress.stage}: ${progress.message || progress.progress + '%'}`);
      }
    });

    result.processingTime = Date.now() - startTime;
    result.pageCount = output.metadata.pageCount;
    result.outputSize = output.html.length + output.css.length;
    result.fontMappings = output.metadata.fontMappings;
    result.htmlGenerated = output.html.length > 0;
    result.textExtracted = output.html.includes('<span') || output.html.includes('<p');
    result.imagesExtracted = output.html.includes('<img');
    result.success = true;

    // Save output
    const outputDir = join(__dirname, '..', 'test-outputs');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const baseName = basename(pdfPath, '.pdf');
    const htmlPath = join(outputDir, `${baseName}.html`);
    const cssPath = join(outputDir, `${baseName}.css`);

    writeFileSync(htmlPath, output.html, 'utf-8');
    writeFileSync(cssPath, output.css, 'utf-8');

    console.log(`   ✓ Success!`);
    console.log(`   Pages: ${result.pageCount}`);
    console.log(`   Time: ${result.processingTime}ms`);
    console.log(`   Output: ${(result.outputSize / 1024).toFixed(2)} KB`);
    console.log(`   Text: ${result.textExtracted ? '✓' : '✗'}`);
    console.log(`   Images: ${result.imagesExtracted ? '✓' : '✗'}`);
    console.log(`   Fonts: ${result.fontMappings}`);
    console.log(`   Saved to: ${htmlPath}`);

    converter.dispose();
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    console.log(`   ✗ Failed: ${result.error}`);
  }

  return result;
}

async function runTests() {
  console.log('🧪 PDF2HTML Test Suite');
  console.log('='.repeat(60));

  const results: TestResult[] = [];
  const pdfsDir = join(__dirname, '..', 'demo', 'pdfs');

  for (const pdfName of testPDFs) {
    const pdfPath = join(pdfsDir, pdfName);
    const result = await testPDF(pdfPath);
    results.push(result);
  }

  // Generate report
  console.log('\n📊 Test Summary');
  console.log('='.repeat(60));

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`Total: ${results.length}`);
  console.log(`✓ Successful: ${successful}`);
  console.log(`✗ Failed: ${failed}`);

  console.log('\nDetailed Results:');
  results.forEach(result => {
    const status = result.success ? '✓' : '✗';
    console.log(`  ${status} ${result.pdfName}`);
    if (result.success) {
      console.log(`     Pages: ${result.pageCount}, Time: ${result.processingTime}ms`);
      console.log(`     Text: ${result.textExtracted ? '✓' : '✗'}, Images: ${result.imagesExtracted ? '✓' : '✗'}`);
    } else {
      console.log(`     Error: ${result.error}`);
    }
  });

  // Save JSON report
  const reportPath = join(__dirname, '..', 'test-outputs', 'test-report.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n📄 Report saved to: ${reportPath}`);

  // Exit with error code if any tests failed
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

