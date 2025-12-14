export interface HTMLOutput {
  html: string;
  css: string;
  metadata: OutputMetadata;
  fonts: string[];
  text?: string;
}

export interface OutputMetadata {
  pageCount: number;
  processingTime: number;
  ocrUsed: boolean;
  fontMappings: number;
  originalMetadata?: Record<string, unknown>;
  scannedPDF?: boolean;
  scanConfidence?: number;
  imageStats?: {
    totalPages: number;
    totalImages: number;
    positionedImages: number;
    fullPageRasterImages: number;
    rasterGraphics: number;
  };
}

export interface HTMLGenerationOptions {
  format: 'html' | 'html+css' | 'html+inline-css';
  preserveLayout: boolean;
  responsive: boolean;
  darkMode: boolean;
  baseUrl?: string;
  imageFormat: 'base64' | 'url';
  textLayout?: 'absolute' | 'smart' | 'flow';
  textLayoutPasses?: 1 | 2;
  textRenderMode?: 'html' | 'svg';
  textPipeline?: 'legacy' | 'v2';
  includeExtractedText?: boolean;
  textClassifier?: 'rule';
  textClassifierProfile?: string;
}

export interface CSSOptions {
  includeFonts: boolean;
  includeReset: boolean;
  includePrint: boolean;
  customStyles?: string;
}


