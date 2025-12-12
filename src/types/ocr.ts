export interface OCRConfig {
  confidenceThreshold: number;
  language?: string;
  preprocess?: boolean;
  autoRotate?: boolean;
}

export interface OCRResult {
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
  words: OCRWord[];
}

export interface OCRWord {
  text: string;
  confidence: number;
  boundingBox: BoundingBox;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OCRPageResult {
  pageNumber: number;
  results: OCRResult[];
  processingTime: number;
  imageData?: string;
}

export interface OCRProcessorOptions {
  batchSize?: number;
  maxConcurrent?: number;
  timeout?: number;
}


