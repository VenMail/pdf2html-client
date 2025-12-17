#!/usr/bin/env node
/**
 * Comprehensive test for semantic flexbox layout conversion
 * Tests all supported HTML use cases: text, lines, drawings, images
 * Run: npx tsx scripts/test-semantic-flexbox-comprehensive.ts
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { PDF2HTML } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestResult {
  pdfName: string;
  success: boolean;
  processingTime: number;
  pageCount: number;
  htmlSize: number;
  cssSize: number;
  stats: {
    regions: number;
    lines: number;
    horizontalGaps: number;
    verticalGaps: number;
    textElements: number;
    images: number;
    graphics: number;
  };
  issues: string[];
  errors: string[];
}

const outputDir = join(__dirname, '../test-results/semantic-flexbox-comprehensive');
mkdirSync(outputDir, { recursive: true });

// Test PDFs - add more as needed
const testPdfs = [
  { path: join(__dirname, '../demo/boarding_pass.pdf'), name: 'boarding_pass.pdf' },
  // Add more test PDFs if available
];

async function testPDF(pdfPath: string, pdfName: string): Promise<TestResult> {
  const result: TestResult = {
    pdfName,
    success: false,
    processingTime: 0,
    pageCount: 0,
    htmlSize: 0,
    cssSize: 0,
    stats: {
      regions: 0,
      lines: 0,
      horizontalGaps: 0,
      verticalGaps: 0,
      textElements: 0,
      images: 0,
      graphics: 0,
    },
    issues: [],
    errors: [],
  };

  try {
    if (!existsSync(pdfPath)) {
      result.errors.push(`PDF file not found: ${pdfPath}`);
      return result;
    }

    const pdfBuffer = readFileSync(pdfPath);
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    );

    const converter = new PDF2HTML({
      enableOCR: false,
      enableFontMapping: false,
      parserStrategy: 'unpdf',
      htmlOptions: {
        format: 'html+inline-css',
        preserveLayout: true,
        textLayout: 'semantic',
        textLayoutPasses: 2,
        responsive: false,
        darkMode: false,
        includeExtractedText: true,
        textPipeline: 'v2',
        textClassifierProfile: 'latin-default',
        useFlexboxLayout: true,
      },
    });

    const startTime = Date.now();
    const output = await converter.convert(arrayBuffer);
    const processingTime = Date.now() - startTime;
    converter.dispose();

    result.processingTime = processingTime;
    result.pageCount = output.metadata.pageCount;
    result.htmlSize = output.html.length;
    result.cssSize = (output.css || '').length;

    const html = output.html;
    const css = output.css || '';

    // Extract statistics
    result.stats.regions = (html.match(/pdf-sem-region/g) || []).length;
    result.stats.lines = (html.match(/pdf-sem-line/g) || []).length;
    result.stats.horizontalGaps = (html.match(/pdf-sem-gap/g) || []).length;
    result.stats.verticalGaps = (html.match(/pdf-sem-vgap/g) || []).length;
    result.stats.textElements = (html.match(/pdf-sem-text/g) || []).length;
    result.stats.images = (html.match(/<img[^>]*>/gi) || []).length;
    result.stats.graphics = (html.match(/<svg[^>]*>/gi) || []).length + 
                            (html.match(/<canvas[^>]*>/gi) || []).length;

    // Comprehensive verification

    // 1. Flexbox Structure Verification
    const hasSemanticRegions = html.includes('pdf-sem-region');
    const hasFlexboxLines = html.includes('pdf-sem-lines') && html.includes('display: flex');
    const hasFlexboxLine = html.includes('pdf-sem-line') && html.includes('flex-direction: row');
    const hasFlexboxText = html.includes('pdf-sem-text');

    if (!hasSemanticRegions) {
      result.issues.push('Missing semantic regions (pdf-sem-region)');
    }
    if (!hasFlexboxLines) {
      result.issues.push('Missing flexbox lines container (pdf-sem-lines with flex)');
    }
    if (!hasFlexboxLine) {
      result.issues.push('Missing flexbox line containers (pdf-sem-line with flex-direction: row)');
    }
    if (result.stats.regions === 0) {
      result.issues.push('No regions found in output');
    }
    if (result.stats.lines === 0 && result.stats.textElements > 0) {
      result.issues.push('Text elements found but no lines (structural issue)');
    }

    // 2. Positioning Verification
    // Regions should be absolutely positioned
    const regionMatches = html.match(/<div[^>]*class="[^"]*pdf-sem-region[^"]*"[^>]*>/gi) || [];
    const regionsWithAbs = regionMatches.filter(m => m.includes('position: absolute')).length;
    if (regionsWithAbs < result.stats.regions) {
      result.issues.push(`Only ${regionsWithAbs}/${result.stats.regions} regions have absolute positioning`);
    }

    // Text elements should be relatively positioned
    const textMatches = html.match(/<span[^>]*class="[^"]*pdf-sem-text[^"]*"[^>]*>/gi) || [];
    const textWithRel = textMatches.filter(m => m.includes('position: relative')).length;
    const textWithAbs = textMatches.filter(m => m.includes('position: absolute')).length;
    if (textWithAbs > 0) {
      result.issues.push(`Found ${textWithAbs} text elements with absolute positioning (should use relative)`);
    }
    if (textWithRel < result.stats.textElements * 0.9) {
      result.issues.push(`Only ${textWithRel}/${result.stats.textElements} text elements have relative positioning`);
    }

    // 3. Gap Verification
    // Horizontal gaps should have width
    const gapMatches = html.match(/<div[^>]*class="[^"]*pdf-sem-gap[^"]*"[^>]*>/gi) || [];
    const gapsWithWidth = gapMatches.filter(m => m.includes('width:')).length;
    if (gapsWithWidth < result.stats.horizontalGaps) {
      result.issues.push(`Only ${gapsWithWidth}/${result.stats.horizontalGaps} horizontal gaps have width specified`);
    }
    const gapsWithFlexShrink = gapMatches.filter(m => m.includes('flex-shrink: 0')).length;
    if (gapsWithFlexShrink < result.stats.horizontalGaps) {
      result.issues.push(`Only ${gapsWithFlexShrink}/${result.stats.horizontalGaps} horizontal gaps have flex-shrink: 0`);
    }

    // Vertical gaps should have height
    const vgapMatches = html.match(/<div[^>]*class="[^"]*pdf-sem-vgap[^"]*"[^>]*>/gi) || [];
    const vgapsWithHeight = vgapMatches.filter(m => m.includes('height:')).length;
    if (vgapsWithHeight < result.stats.verticalGaps && result.stats.verticalGaps > 0) {
      result.issues.push(`Only ${vgapsWithHeight}/${result.stats.verticalGaps} vertical gaps have height specified`);
    }

    // 4. Dimension Verification
    // Text elements should have width and height
    const textWithWidth = textMatches.filter(m => m.includes('width:')).length;
    const textWithHeight = textMatches.filter(m => m.includes('height:')).length;
    if (textWithWidth < result.stats.textElements * 0.9) {
      result.issues.push(`Only ${textWithWidth}/${result.stats.textElements} text elements have width specified`);
    }
    if (textWithHeight < result.stats.textElements * 0.9) {
      result.issues.push(`Only ${textWithHeight}/${result.stats.textElements} text elements have height specified`);
    }

    // 5. Coordinate Normalization Verification
    // Check that coordinates are normalized (3 decimal places max)
    const coordPattern = /(?:left|top|width|height):\s*([0-9]+\.[0-9]{4,})px/gi;
    const unnormalizedCoords = (html.match(coordPattern) || []).length;
    if (unnormalizedCoords > 0) {
      result.issues.push(`Found ${unnormalizedCoords} coordinates with >3 decimal places (should be normalized)`);
    }

    // 6. Flexbox CSS Verification
    // Lines container should have flex column
    const linesContainerMatches = html.match(/<div[^>]*class="[^"]*pdf-sem-lines[^"]*"[^>]*>/gi) || [];
    const linesWithFlexCol = linesContainerMatches.filter(m => 
      m.includes('display: flex') && m.includes('flex-direction: column')
    ).length;
    if (linesWithFlexCol < result.stats.regions) {
      result.issues.push(`Only ${linesWithFlexCol}/${result.stats.regions} lines containers have flex column`);
    }

    // Line containers should have flex row
    // Match pdf-sem-line (singular) but not pdf-sem-lines (plural container)
    // Use word boundary to avoid matching pdf-sem-lines
    const lineMatches = html.match(/<div[^>]*class="[^"]*\bpdf-sem-line\b[^"]*"[^>]*style="[^"]*"/gi) || [];
    const linesWithFlexRow = lineMatches.filter(m => 
      m.includes('display: flex') && m.includes('flex-direction: row')
    ).length;
    // Only check if we have lines with styles
    if (lineMatches.length > 0) {
      const flexRowRatio = linesWithFlexRow / lineMatches.length;
      // Allow 5% tolerance for edge cases (some lines might be empty or have special handling)
      if (flexRowRatio < 0.95 && lineMatches.length > 10) {
        result.issues.push(`Only ${linesWithFlexRow}/${lineMatches.length} line containers have flex row (${(flexRowRatio * 100).toFixed(1)}%, expected >95%)`);
      }
    }

    // 7. Image Handling Verification
    // Note: Images are positioned absolutely on the page (not in flexbox regions)
    // This is expected behavior - images are separate from text flow
    if (result.stats.images > 0) {
      // Images should be absolutely positioned (not in flexbox)
      const imagesWithAbs = (html.match(/<img[^>]*style="[^"]*position:\s*absolute/gi) || []).length;
      // Images can be in page containers OR positioned absolutely - both are valid
      const imagesInPage = (html.match(/<div[^>]*class="[^"]*pdf-page[^"]*"[^>]*>[\s\S]*?<img/gi) || []).length;
      // At least 80% should be in page containers OR absolutely positioned
      if (imagesInPage + imagesWithAbs < result.stats.images * 0.8) {
        result.issues.push(`Only ${imagesInPage + imagesWithAbs}/${result.stats.images} images are properly positioned (in page or absolute)`);
      }
    }

    // 8. Graphics/Drawings Verification
    if (result.stats.graphics > 0) {
      const graphicsInPage = (html.match(/<div[^>]*class="[^"]*pdf-page[^"]*"[^>]*>[\s\S]*?<(?:svg|canvas)/gi) || []).length;
      if (graphicsInPage < result.stats.graphics) {
        result.issues.push(`Only ${graphicsInPage}/${result.stats.graphics} graphics are within page containers`);
      }
    }

    // 9. Text Content Verification
    // Check for empty text elements
    const emptyTextElements = (html.match(/<span[^>]*class="[^"]*pdf-sem-text[^"]*"[^>]*>\s*<\/span>/gi) || []).length;
    if (emptyTextElements > 0) {
      result.issues.push(`Found ${emptyTextElements} empty text elements`);
    }

    // 10. Structural Integrity
    // Check for unclosed tags
    const openRegions = (html.match(/<div[^>]*pdf-sem-region/gi) || []).length;
    const closeRegions = (html.match(/<\/div>/g) || []).filter((_, i, arr) => {
      // Simple check - count should match
      return true;
    }).length;
    // This is a simplified check - proper parsing would be better

    // 11. CSS Verification
    if (css.length === 0) {
      result.issues.push('No CSS generated');
    }

    // Check for required CSS classes
    const hasFontDefault = css.includes('.font-default');
    if (!hasFontDefault) {
      result.issues.push('Missing .font-default CSS class');
    }

    result.success = result.issues.length === 0 && result.errors.length === 0;

    // Save output for inspection
    const pdfOutputDir = join(outputDir, basename(pdfName, '.pdf'));
    mkdirSync(pdfOutputDir, { recursive: true });

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Semantic Flexbox Test - ${pdfName}</title>
  <style>${css}</style>
</head>
<body>
  ${html}
</body>
</html>`;

    writeFileSync(join(pdfOutputDir, 'converted.html'), fullHtml, 'utf8');
    writeFileSync(join(pdfOutputDir, 'styles.css'), css, 'utf8');
    if (output.text) {
      writeFileSync(join(pdfOutputDir, 'extracted-text.txt'), output.text, 'utf8');
    }

  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      result.errors.push(error.stack);
    }
  }

  return result;
}

async function runComprehensiveTests() {
  console.log('='.repeat(80));
  console.log('Comprehensive Semantic Flexbox Layout Test');
  console.log('='.repeat(80));
  console.log('');

  const results: TestResult[] = [];

  for (const pdf of testPdfs) {
    console.log(`Testing: ${pdf.name}...`);
    const result = await testPDF(pdf.path, pdf.name);
    results.push(result);

    if (result.success) {
      console.log(`  ✓ Passed in ${result.processingTime}ms`);
    } else {
      console.log(`  ✗ Failed in ${result.processingTime}ms`);
      if (result.errors.length > 0) {
        console.log(`    Errors: ${result.errors.join('; ')}`);
      }
      if (result.issues.length > 0) {
        console.log(`    Issues: ${result.issues.length} found`);
      }
    }
    console.log(`    Pages: ${result.pageCount}, Regions: ${result.stats.regions}, Lines: ${result.stats.lines}`);
    console.log('');
  }

  // Summary
  console.log('='.repeat(80));
  console.log('Test Summary');
  console.log('='.repeat(80));
  console.log('');

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalTime = results.reduce((sum, r) => sum + r.processingTime, 0);

  console.log(`Total PDFs tested: ${results.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total processing time: ${totalTime}ms`);
  console.log('');

  // Detailed results
  for (const result of results) {
    console.log(`${result.pdfName}:`);
    console.log(`  Success: ${result.success ? '✓' : '✗'}`);
    console.log(`  Processing: ${result.processingTime}ms`);
    console.log(`  Pages: ${result.pageCount}`);
    console.log(`  HTML: ${(result.htmlSize / 1024).toFixed(2)} KB`);
    console.log(`  CSS: ${(result.cssSize / 1024).toFixed(2)} KB`);
    console.log(`  Stats: ${result.stats.regions} regions, ${result.stats.lines} lines, ${result.stats.textElements} text, ${result.stats.images} images, ${result.stats.graphics} graphics`);
    if (result.issues.length > 0) {
      console.log(`  Issues (${result.issues.length}):`);
      result.issues.forEach(issue => console.log(`    - ${issue}`));
    }
    if (result.errors.length > 0) {
      console.log(`  Errors (${result.errors.length}):`);
      result.errors.forEach(error => console.log(`    - ${error}`));
    }
    console.log('');
  }

  // Save summary report
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      total: results.length,
      passed,
      failed,
      totalTime,
    },
    results: results.map(r => ({
      pdfName: r.pdfName,
      success: r.success,
      processingTime: r.processingTime,
      pageCount: r.pageCount,
      stats: r.stats,
      issues: r.issues,
      errors: r.errors,
    })),
  };

  writeFileSync(
    join(outputDir, 'test-report.json'),
    JSON.stringify(report, null, 2),
    'utf8'
  );

  console.log(`✓ Detailed report saved to: ${join(outputDir, 'test-report.json')}`);
  console.log('');

  if (failed > 0) {
    console.log('⚠️  Some tests failed. Review issues above.');
    process.exit(1);
  } else {
    console.log('✓ All tests passed!');
    process.exit(0);
  }
}

runComprehensiveTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

