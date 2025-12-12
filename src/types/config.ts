import type { PDFParserOptions } from './pdf.js';
import type { OCRConfig, OCRProcessorOptions } from './ocr.js';
import type { FontMappingOptions } from './fonts.js';
import type { HTMLGenerationOptions, CSSOptions } from './output.js';

export interface PDF2HTMLConfig {
  // OCR settings
  enableOCR: boolean;
  ocrConfig?: OCRConfig;
  ocrProcessorOptions?: OCRProcessorOptions;

  // Font mapping
  enableFontMapping: boolean;
  fontMappingOptions?: FontMappingOptions;

  // Parser options
  parserOptions?: PDFParserOptions;

  // Output options
  htmlOptions?: HTMLGenerationOptions;
  cssOptions?: CSSOptions;

  // Performance
  maxConcurrentPages?: number;
  wasmMemoryLimit?: number;
  cacheEnabled?: boolean;
}

export interface ConversionProgress {
  stage: 'parsing' | 'ocr' | 'font-mapping' | 'html-generation' | 'complete';
  progress: number;
  currentPage?: number;
  totalPages?: number;
  message?: string;
}

export type ProgressCallback = (progress: ConversionProgress) => void;


