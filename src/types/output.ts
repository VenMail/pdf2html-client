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
  textLayout?: 'absolute' | 'smart' | 'flow' | 'semantic';
  textLayoutPasses?: 1 | 2;
  textRenderMode?: 'html' | 'svg';
  textPipeline?: 'legacy' | 'v2' | 'smart';
  includeExtractedText?: boolean;
  textClassifier?: 'rule';
  textClassifierProfile?: string;
  layoutTuning?: {
    absElementLineHeightFactor?: number;
    absRunLineHeightFactor?: number;
    absLineHeightFactor?: number;
    lineGroupingFontSizeFactor?: number;
  };
  layoutAdapter?: {
    mode: 'none' | 'flex';
    rowThresholdPx?: number;
    minGapPx?: number;
    preserveVerticalGaps?: boolean;
  };
  semanticLayout?: {
    blockGapFactor?: number;
    headingThreshold?: number;
    maxHeadingLength?: number;
  };
  useFlexboxLayout?: boolean; // Use flexbox for semantic layout (default: true)
  semanticPositionedLayout?: {
    mergeSameStyleLines?: boolean;
    whitespacePadding?: boolean;
  };
}

export interface CSSOptions {
  includeFonts: boolean;
  includeReset: boolean;
  includePrint: boolean;
  customStyles?: string;
}


