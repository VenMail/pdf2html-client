import { PDF2HTML } from './demo/dist/index.js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const pdfsDir = join(__dirname, 'demo/pdfs');
const outputDir = join(__dirname, 'test-results/html-outputs');

async function convertPDF(pdfName, type) {
  console.log(`Converting ${pdfName} (${type})...`);

  try {
    const pdfPath = join(pdfsDir, pdfName);
    const pdfBuffer = readFileSync(pdfPath);
    const arrayBuffer = pdfBuffer.buffer.slice(pdfBuffer.byteOffset, pdfBuffer.byteOffset + pdfBuffer.byteLength);

    const converter = new PDF2HTML({
      enableOCR: false,
      enableFontMapping: true,
      htmlOptions: {
        format: 'html+inline-css',
        preserveLayout: true,
        responsive: true,
        darkMode: false,
      },
    });

    const output = await converter.convert(arrayBuffer, (progress) => {
      console.log(`  ${progress.stage}: ${progress.progress}%`);
    });

    // Save outputs
    mkdirSync(outputDir, { recursive: true });
    const baseName = pdfName.replace('.pdf', '');
    const htmlPath = join(outputDir, `${baseName}.html`);
    const cssPath = join(outputDir, `${baseName}.css`);

    const fullHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${pdfName} - Converted</title>
  <style>${output.css}</style>
</head>
<body>
  <div class="pdf-content">
    ${output.html}
  </div>
</body>
</html>`;

    writeFileSync(htmlPath, fullHtml, 'utf8');
    writeFileSync(cssPath, output.css, 'utf8');

    console.log(`✓ Saved ${htmlPath}`);
    console.log(`✓ Saved ${cssPath}`);
    console.log(`  Pages: ${output.metadata.pageCount}`);
    console.log(`  Output size: ${(output.html.length + output.css.length) / 1024} KB`);

    converter.dispose();
  } catch (error) {
    console.error(`✗ Failed to convert ${pdfName}:`, error);
  }
}

async function main() {
  const pdfs = [
    { name: 'Talent Agreement.pdf', type: 'simple' },
    { name: 'PermitOutcome_440112 (1).pdf', type: 'mixed' },
    { name: '03.pdf', type: 'multi-page' },
    { name: 'company_profile.pdf', type: 'complex' },
  ];

  for (const pdf of pdfs) {
    await convertPDF(pdf.name, pdf.type);
  }

  console.log('\nConversion complete! Check test-results/html-outputs/ for outputs.');
}

main().catch(console.error);
