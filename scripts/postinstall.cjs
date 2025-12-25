const { existsSync, mkdirSync, writeFileSync, copyFileSync } = require('fs');
const { join } = require('path');

const MODELS_DIR = join(process.cwd(), 'models');
const MODELS_BASE_URL = 'https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/raw/main/models';

const REQUIRED_MODELS = [
  {
    name: 'PP-OCRv5_mobile_det_infer.onnx',
    url: `${MODELS_BASE_URL}/PP-OCRv5_mobile_det_infer.onnx`,
    description: 'PPU Mobile Detection Model'
  },
  {
    name: 'en_PP-OCRv4_mobile_rec_infer.onnx',
    url: `${MODELS_BASE_URL}/en_PP-OCRv4_mobile_rec_infer.onnx`,
    description: 'PPU Mobile Recognition Model (English)'
  },
  {
    name: 'en_dict.txt',
    url: `${MODELS_BASE_URL}/en_dict.txt`,
    description: 'English Character Dictionary'
  }
];

async function downloadModel(url, outputPath) {
  console.log(`Downloading ${url}...`);
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.statusText}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  writeFileSync(outputPath, buffer);
  const sizeMB = (buffer.length / (1024 * 1024)).toFixed(2);
  console.log(`✓ Downloaded ${outputPath} (${sizeMB} MB)`);
}

async function ensureModels() {
  console.log('Checking for required OCR models...\n');

  try {
    mkdirSync(MODELS_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  let downloadedCount = 0;
  let skippedCount = 0;

  for (const model of REQUIRED_MODELS) {
    const modelPath = join(MODELS_DIR, model.name);

    if (existsSync(modelPath)) {
      console.log(`✓ ${model.name} already exists, skipping...`);
      skippedCount++;
      continue;
    }

    try {
      await downloadModel(model.url, modelPath);
      downloadedCount++;
    } catch (error) {
      console.error(`✗ Failed to download ${model.name}:`, error);
      throw error;
    }
  }

  if (downloadedCount > 0) {
    console.log(`\n✓ Downloaded ${downloadedCount} model(s)`);
  }

  if (skippedCount > 0) {
    console.log(`✓ ${skippedCount} model(s) already present`);
  }

  if (downloadedCount === 0 && skippedCount === REQUIRED_MODELS.length) {
    console.log('\n✓ All required models are present');
  }

  console.log(`Models directory: ${MODELS_DIR}`);
}

async function ensurePdfiumWasm() {
  const demoPublicDir = join(process.cwd(), 'demo', 'public');
  const outPath = join(demoPublicDir, 'pdfium.wasm');
  const srcPath = join(process.cwd(), 'node_modules', '@embedpdf', 'pdfium', 'dist', 'pdfium.wasm');

  try {
    mkdirSync(demoPublicDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  if (!existsSync(srcPath)) {
    console.warn(`PDFium wasm not found at ${srcPath}. Skipping local wasm copy.`);
    return;
  }

  if (existsSync(outPath)) {
    return;
  }

  copyFileSync(srcPath, outPath);
  console.log(`✓ Copied PDFium wasm to ${outPath}`);
}

async function main() {
  console.log('🚀 pdf2html-client postinstall setup\n');
  console.log('This script will download required OCR models and copy PDFium wasm files.');
  console.log('Models will be downloaded to ./models/ directory.\n');

  // Check if user wants to skip automatic setup
  const skipAuto = process.env.PDF2HTML_SKIP_AUTO_SETUP === 'true' ||
                   process.argv.includes('--skip-auto');

  if (skipAuto) {
    console.log('⏭️  Skipping automatic setup due to PDF2HTML_SKIP_AUTO_SETUP=true or --skip-auto flag');
    console.log('\n📝 To manually set up models later, run:');
    console.log('   node node_modules/pdf2html-client/scripts/postinstall.js');
    console.log('\n📝 Or use the npm script:');
    console.log('   pnpm run pdf2html:setup-models');
    return;
  }

  try {
    await ensureModels();
    await ensurePdfiumWasm();
    console.log('\n✅ pdf2html-client setup completed successfully!');
  } catch (error) {
    console.error('\n❌ Error during setup:', error.message);
    console.log('\n📝 You can retry the setup manually by running:');
    console.log('   node node_modules/pdf2html-client/scripts/postinstall.js');
    console.log('\n📝 Or use the npm script:');
    console.log('   pnpm run pdf2html:setup-models');
    console.log('\n📝 To skip automatic setup in future installs, set:');
    console.log('   PDF2HTML_SKIP_AUTO_SETUP=true');
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Unexpected error:', error);
  process.exit(1);
});
