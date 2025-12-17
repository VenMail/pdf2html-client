#!/usr/bin/env node
/**
 * Simple script to test semantic flexbox layout conversion
 * Run: npx tsx scripts/test-semantic-flexbox.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PDF2HTML } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pdfPath = join(__dirname, '../demo/boarding_pass.pdf');
const outputDir = join(__dirname, '../test-results/semantic-flexbox-test');
mkdirSync(outputDir, { recursive: true });

async function testSemanticFlexbox() {
  console.log('Testing semantic flexbox layout conversion...\n');

  try {
    const pdfBuffer = readFileSync(pdfPath);
    const arrayBuffer = pdfBuffer.buffer.slice(
      pdfBuffer.byteOffset,
      pdfBuffer.byteOffset + pdfBuffer.byteLength
    );

    const converter = new PDF2HTML({
      enableOCR: false,
      enableFontMapping: false,
      parserStrategy: 'unpdf', // Use unpdf for Node.js environment
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
        useFlexboxLayout: true, // Explicitly enable flexbox
      },
    });

    console.log('Converting PDF...');
    const startTime = Date.now();
    const output = await converter.convert(arrayBuffer);
    const processingTime = Date.now() - startTime;
    converter.dispose();

    console.log(`✓ Conversion completed in ${processingTime}ms`);
    console.log(`✓ Pages: ${output.metadata.pageCount}\n`);

    const html = output.html;
    const css = output.css || '';

    // Verify flexbox structure
    const hasSemanticRegions = html.includes('pdf-sem-region');
    const hasFlexboxLines = html.includes('pdf-sem-lines') && html.includes('display: flex');
    const hasFlexboxLine = html.includes('pdf-sem-line') && html.includes('flex-direction: row');
    const hasFlexboxGaps = html.includes('pdf-sem-gap') || html.includes('pdf-sem-vgap');
    const hasFlexboxText = html.includes('pdf-sem-text');

    const regionCount = (html.match(/pdf-sem-region/g) || []).length;
    const lineCount = (html.match(/pdf-sem-line/g) || []).length;
    const gapCount = (html.match(/pdf-sem-gap/g) || []).length;
    const vgapCount = (html.match(/pdf-sem-vgap/g) || []).length;

    console.log('Flexbox Layout Verification:');
    console.log(`  Semantic regions: ${hasSemanticRegions ? '✓' : '✗'} (${regionCount} found)`);
    console.log(`  Flexbox lines container: ${hasFlexboxLines ? '✓' : '✗'}`);
    console.log(`  Flexbox line containers: ${hasFlexboxLine ? '✓' : '✗'} (${lineCount} found)`);
    console.log(`  Flexbox gap elements: ${hasFlexboxGaps ? '✓' : '✗'} (${gapCount} horizontal, ${vgapCount} vertical)`);
    console.log(`  Flexbox text elements: ${hasFlexboxText ? '✓' : '✗'}\n`);

    // Check for critical issues
    const issues: string[] = [];
    if (!hasSemanticRegions) {
      issues.push('Missing semantic regions (pdf-sem-region)');
    }
    if (!hasFlexboxLines) {
      issues.push('Missing flexbox lines container (pdf-sem-lines with flex)');
    }
    if (!hasFlexboxLine) {
      issues.push('Missing flexbox line containers (pdf-sem-line with flex-direction: row)');
    }
    if (regionCount === 0) {
      issues.push('No regions found in output');
    }
    if (lineCount === 0) {
      issues.push('No lines found in output');
    }

    // Check for absolute positioning in text elements (should not be present in flexbox mode)
    // Regions themselves should be absolutely positioned, but text inside should be relative
    // Only check elements that are direct children of pdf-sem-line or pdf-sem-text
    const absInTextElements = (html.match(/<span[^>]*class="[^"]*pdf-sem-text[^"]*"[^>]*position:\s*absolute/gi) || []).length;
    const absInGaps = (html.match(/<div[^>]*class="[^"]*pdf-sem-gap[^"]*"[^>]*position:\s*absolute/gi) || []).length;
    const absInVgaps = (html.match(/<div[^>]*class="[^"]*pdf-sem-vgap[^"]*"[^>]*position:\s*absolute/gi) || []).length;
    
    if (absInTextElements > 0) {
      issues.push(`Found ${absInTextElements} text elements with absolute positioning (should use relative)`);
    }
    if (absInGaps > 0 || absInVgaps > 0) {
      issues.push(`Found ${absInGaps + absInVgaps} gap elements with absolute positioning (should not have positioning)`);
    }

    if (issues.length > 0) {
      console.log('⚠️  Issues found:');
      issues.forEach(issue => console.log(`  - ${issue}`));
      console.log('');
    } else {
      console.log('✓ All flexbox layout checks passed!\n');
    }

    // Save output files
    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Semantic Flexbox Test</title>
  <style>${css}</style>
</head>
<body>
  ${html}
</body>
</html>`;

    writeFileSync(join(outputDir, 'converted.html'), fullHtml, 'utf8');
    writeFileSync(join(outputDir, 'styles.css'), css, 'utf8');
    if (output.text) {
      writeFileSync(join(outputDir, 'extracted-text.txt'), output.text, 'utf8');
    }

    console.log(`✓ Output files saved to: ${outputDir}`);
    console.log(`  - converted.html`);
    console.log(`  - styles.css`);
    if (output.text) {
      console.log(`  - extracted-text.txt`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('Summary:');
    console.log(`  Processing time: ${processingTime}ms`);
    console.log(`  HTML size: ${(html.length / 1024).toFixed(2)} KB`);
    console.log(`  CSS size: ${(css.length / 1024).toFixed(2)} KB`);
    console.log(`  Regions: ${regionCount}`);
    console.log(`  Lines: ${lineCount}`);
    console.log(`  Gaps: ${gapCount + vgapCount} (${gapCount} horizontal, ${vgapCount} vertical)`);
    console.log(`  Issues: ${issues.length}`);
    console.log('='.repeat(60));

    if (issues.length > 0) {
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error during conversion:', error);
    if (error instanceof Error) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testSemanticFlexbox();

