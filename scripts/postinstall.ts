import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

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

async function downloadModel(url: string, outputPath: string): Promise<void> {
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

async function ensureModels(): Promise<void> {
  console.log('Checking for required OCR models...\n');

  try {
    mkdirSync(MODELS_DIR, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
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

ensureModels().catch((error) => {
  console.error('Error ensuring models:', error);
  process.exit(1);
});

