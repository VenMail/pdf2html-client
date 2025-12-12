export interface HTMLOutput {
  html: string;
  css: string;
  metadata: OutputMetadata;
  fonts: string[];
}

export interface OutputMetadata {
  pageCount: number;
  processingTime: number;
  ocrUsed: boolean;
  fontMappings: number;
  originalMetadata?: Record<string, unknown>;
  scannedPDF?: boolean;
  scanConfidence?: number;
}

export interface HTMLGenerationOptions {
  format: 'html' | 'html+css' | 'html+inline-css';
  preserveLayout: boolean;
  responsive: boolean;
  darkMode: boolean;
  baseUrl?: string;
  imageFormat: 'base64' | 'url';
}

export interface CSSOptions {
  includeFonts: boolean;
  includeReset: boolean;
  includePrint: boolean;
  customStyles?: string;
}


