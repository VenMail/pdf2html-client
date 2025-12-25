import type { PDFParserOptions } from './pdf.js';
import type { OCRConfig, OCRProcessorOptions } from './ocr.js';
import type { FontMappingOptions } from './fonts.js';
import type { HTMLGenerationOptions, CSSOptions, HTMLOutput } from './output.js';

export interface PDF2HTMLConfig {
  // OCR settings
  enableOCR: boolean;
  ocrConfig?: OCRConfig;
  ocrProcessorOptions?: OCRProcessorOptions;

  // Font mapping
  enableFontMapping: boolean;
  fontMappingOptions?: FontMappingOptions;

  // Parser options
  parserStrategy?: 'auto' | 'pdfium' | 'unpdf';
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

// Helper types for common configurations
export type EditingConfig = PDF2HTMLConfig & {
  htmlOptions: {
    textLayout: 'flow';
    preserveLayout: false;
    includeExtractedText: true;
  };
};

export type FidelityConfig = PDF2HTMLConfig & {
  htmlOptions: {
    textLayout: 'absolute';
    preserveLayout: true;
    responsive: false;
  };
};

export type WebConfig = PDF2HTMLConfig & {
  htmlOptions: {
    textLayout: 'semantic';
    preserveLayout: true;
    responsive: true;
  };
};

// Utility type for creating custom configurations
export type CustomConfig<T extends Partial<PDF2HTMLConfig>> = T & {
  htmlOptions: T extends { htmlOptions: infer HO } 
    ? HO extends Partial<HTMLGenerationOptions> 
      ? HO 
      : Partial<HTMLGenerationOptions>
    : Partial<HTMLGenerationOptions>;
};

// Chainable configuration interface for better TypeScript support
export interface ChainablePDF2HTML {
  enableOCR(enabled?: boolean): ChainablePDF2HTML;
  enableFontMapping(enabled?: boolean): ChainablePDF2HTML;
  setParserStrategy(strategy: 'auto' | 'pdfium' | 'unpdf'): ChainablePDF2HTML;
  setTextLayout(layout: 'absolute' | 'smart' | 'flow' | 'semantic'): ChainablePDF2HTML;
  setPreserveLayout(preserve: boolean): ChainablePDF2HTML;
  setResponsive(responsive: boolean): ChainablePDF2HTML;
  setDarkMode(dark: boolean): ChainablePDF2HTML;
  setImageFormat(format: 'base64' | 'url'): ChainablePDF2HTML;
  setOutputFormat(format: 'html' | 'html+css' | 'html+inline-css'): ChainablePDF2HTML;
  includeExtractedText(include?: boolean): ChainablePDF2HTML;
  setOCRConfig(config: NonNullable<PDF2HTMLConfig['ocrConfig']>): ChainablePDF2HTML;
  setMaxConcurrentPages(max: number): ChainablePDF2HTML;
  applyPreset(preset: 'editing' | 'fidelity' | 'web'): ChainablePDF2HTML;
}

// Type for PDF2HTML class with chainable methods
export type PDF2HTMLWithChainable = ChainablePDF2HTML & {
  convert(pdfData: ArrayBuffer | File, progressCallback?: ProgressCallback): Promise<HTMLOutput>;
  dispose(): void;
};
