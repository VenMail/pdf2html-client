#!/usr/bin/env node
/**
 * PDF Analysis Script
 *
 * Analyzes PDF structure and content to help identify issues
 */

require('dotenv/config');
const { PDFParser } = require('../src/core/pdf-parser.js');
const { readFileSync, existsSync, writeFileSync, mkdirSync } = require('fs');
const { join, basename, dirname } = require('path');

async function analyzePDF(pdfPath) {
  const fileName = basename(pdfPath);
  const fileBuffer = readFileSync(pdfPath);
  const fileSize = fileBuffer.length;
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );

  const parser = new PDFParser('auto');
  const issues = [];

  try {
    const document = await parser.parse(arrayBuffer, {
      extractText: true,
      extractImages: true,
      extractGraphics: true,
      extractForms: true,
      extractAnnotations: true
    });

    const pages = [];
    const uniqueFonts = new Set();
    let totalTextItems = 0;
    let totalImages = 0;
    let totalGraphics = 0;
    let totalForms = 0;
    let totalAnnotations = 0;

    for (const page of document.pages) {
      const pageFonts = page.content.text
        .map(t => t.fontFamily)
        .filter(f => !!f);

      pageFonts.forEach(f => uniqueFonts.add(f));

      const pageAnalysis = {
        pageNumber: page.pageNumber,
        width: page.width,
        height: page.height,
        textItems: page.content.text.length,
        images: page.content.images.length,
        graphics: page.content.graphics.length,
        forms: page.content.forms.length,
        annotations: page.content.annotations.length,
        fonts: [...new Set(pageFonts)],
        orientation: page.width > page.height ? 'landscape' : 'portrait'
      };

      pages.push(pageAnalysis);

      totalTextItems += page.content.text.length;
      totalImages += page.content.images.length;
      totalGraphics += page.content.graphics.length;
      totalForms += page.content.forms.length;
      totalAnnotations += page.content.annotations.length;

      // Check for issues
      if (page.content.text.length === 0 && page.content.images.length > 0) {
        issues.push(`Page ${page.pageNumber + 1}: Has images but no text (may need OCR)`);
      }

      if (page.content.graphics.length > 0) {
        issues.push(`Page ${page.pageNumber + 1}: Contains ${page.content.graphics.length} graphics (not yet converted to SVG)`);
      }

      if (page.content.forms.length > 0) {
        issues.push(`Page ${page.pageNumber + 1}: Contains ${page.content.forms.length} form fields (not yet rendered)`);
      }

      if (page.content.annotations.length > 0) {
        issues.push(`Page ${page.pageNumber + 1}: Contains ${page.content.annotations.length} annotations (not yet rendered)`);
      }
    }

    const analysis = {
      fileName,
      fileSize,
      pageCount: document.pageCount,
      pages,
      metadata: document.metadata,
      hasText: totalTextItems > 0,
      hasImages: totalImages > 0,
      hasGraphics: totalGraphics > 0,
      hasForms: totalForms > 0,
      hasAnnotations: totalAnnotations > 0,
      textContentCount: totalTextItems,
      imageCount: totalImages,
      uniqueFonts: Array.from(uniqueFonts),
      issues
    };

    parser.dispose();
    return analysis;
  } catch (error) {
    parser.dispose();
    throw error;
  }
}

async function runAnalysis() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.error('Usage: npm run analyze-pdf <path-to-pdf>');
    process.exit(1);
  }

  if (!existsSync(pdfPath)) {
    console.error(`PDF not found: ${pdfPath}`);
    process.exit(1);
  }

  console.log(`\n🔍 Analyzing PDF: ${basename(pdfPath)}\n`);

  try {
    const analysis = await analyzePDF(pdfPath);

    console.log('='.repeat(60));
    console.log('PDF Analysis Report');
    console.log('='.repeat(60));
    console.log(`File: ${analysis.fileName}`);
    console.log(`Size: ${(analysis.fileSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`Pages: ${analysis.pageCount}`);
    console.log(`\nContent Summary:`);
    console.log(`  Text items: ${analysis.textContentCount}`);
    console.log(`  Images: ${analysis.imageCount}`);
    console.log(`  Graphics: ${analysis.pages.reduce((sum, p) => sum + p.graphics, 0)}`);
    console.log(`  Forms: ${analysis.pages.reduce((sum, p) => sum + p.forms, 0)}`);
    console.log(`  Annotations: ${analysis.pages.reduce((sum, p) => sum + p.annotations, 0)}`);
    console.log(`  Unique fonts: ${analysis.uniqueFonts.length}`);

    if (analysis.uniqueFonts.length > 0) {
      console.log(`\nFonts found:`);
      analysis.uniqueFonts.forEach(font => {
        console.log(`  - ${font}`);
      });
    }

    console.log(`\nPage Details:`);
    analysis.pages.forEach(page => {
      console.log(`  Page ${page.pageNumber + 1} (${page.orientation}):`);
      console.log(`    Size: ${page.width.toFixed(0)}x${page.height.toFixed(0)}`);
      console.log(`    Text: ${page.textItems}, Images: ${page.images}, Graphics: ${page.graphics}`);
      if (page.fonts.length > 0) {
        console.log(`    Fonts: ${page.fonts.join(', ')}`);
      }
    });

    if (analysis.issues.length > 0) {
      console.log(`\n⚠️  Issues Found:`);
      analysis.issues.forEach(issue => {
        console.log(`  - ${issue}`);
      });
    }

    // Save detailed report
    const outputDir = join(__dirname, '..', 'test-outputs');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    const reportPath = join(outputDir, `${basename(pdfPath, '.pdf')}-analysis.json`);
    writeFileSync(reportPath, JSON.stringify(analysis, null, 2), 'utf-8');
    console.log(`\n📄 Detailed report saved to: ${reportPath}`);

  } catch (error) {
    console.error('Analysis failed:', error);
    process.exit(1);
  }
}

runAnalysis();
