import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const MODELS_DIR = join(process.cwd(), 'models');
const MODELS_BASE_URL = 'https://github.com/PT-Perkasa-Pilar-Utama/ppu-paddle-ocr/raw/main/models';

const MODELS = [
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

async function downloadAllModels(): Promise<void> {
  console.log('Downloading PPU-Paddle-OCR models...\n');

  try {
    mkdirSync(MODELS_DIR, { recursive: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }

  for (const model of MODELS) {
    const outputPath = join(MODELS_DIR, model.name);
    try {
      await downloadModel(model.url, outputPath);
    } catch (error) {
      console.error(`✗ Failed to download ${model.name}:`, error);
      throw error;
    }
  }

  console.log('\n✓ All models downloaded successfully!');
  console.log(`Models are located in: ${MODELS_DIR}`);
}

downloadAllModels().catch((error) => {
  console.error('Error downloading models:', error);
  process.exit(1);
});

